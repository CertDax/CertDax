from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
from app.database import get_db
from app.models.agent_group import AgentGroup, AgentGroupMember
from app.models.certificate import Certificate
from app.models.deployment import AgentCertificate, CertificateDeployment, DeploymentTarget
from app.models.selfsigned import SelfSignedCertificate
from app.models.user import User
from app.schemas.agent_group import (
    AgentGroupAssignCertificate,
    AgentGroupCreate,
    AgentGroupDetailResponse,
    AgentGroupMemberInfo,
    AgentGroupResponse,
    AgentGroupUpdate,
)

router = APIRouter()

OFFLINE_THRESHOLD_SECONDS = 120


def _compute_status(target: DeploymentTarget) -> str:
    if not target.last_seen:
        return "offline"
    last = target.last_seen.replace(tzinfo=timezone.utc) if target.last_seen.tzinfo is None else target.last_seen
    if datetime.now(timezone.utc) - last < timedelta(seconds=OFFLINE_THRESHOLD_SECONDS):
        return "online"
    return "offline"


@router.get("", response_model=list[AgentGroupResponse])
def list_agent_groups(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    groups = (
        db.query(AgentGroup)
        .filter(AgentGroup.group_id.in_(visible_group_ids(db, user, "agents")))
        .order_by(AgentGroup.name)
        .all()
    )
    result = []
    for g in groups:
        resp = AgentGroupResponse.model_validate(g)
        resp.member_count = len(g.members)
        result.append(resp)
    return result


@router.post("", response_model=AgentGroupResponse)
def create_agent_group(
    req: AgentGroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ag = AgentGroup(
        name=req.name,
        description=req.description,
        group_id=user.group_id,
    )
    db.add(ag)
    db.commit()
    db.refresh(ag)
    resp = AgentGroupResponse.model_validate(ag)
    resp.member_count = 0
    return resp


@router.get("/{group_id}", response_model=AgentGroupDetailResponse)
def get_agent_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ag = (
        db.query(AgentGroup)
        .filter(AgentGroup.id == group_id, AgentGroup.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not ag:
        raise HTTPException(status_code=404, detail="Agent group not found")

    resp = AgentGroupDetailResponse.model_validate(ag)
    resp.member_count = len(ag.members)
    members = []
    for m in ag.members:
        mi = AgentGroupMemberInfo.model_validate(m)
        if m.target:
            mi.target_name = m.target.name
            mi.target_hostname = m.target.hostname
            mi.target_status = _compute_status(m.target)
        members.append(mi)
    resp.members = members

    # Collect certificate IDs assigned to any member of this group
    member_ids = [m.target_id for m in ag.members]
    if member_ids:
        assigned = db.query(AgentCertificate).filter(AgentCertificate.target_id.in_(member_ids)).all()
        resp.assigned_certificate_ids = list({a.certificate_id for a in assigned if a.certificate_id})
        resp.assigned_self_signed_ids = list({a.self_signed_certificate_id for a in assigned if a.self_signed_certificate_id})

    return resp


@router.put("/{group_id}", response_model=AgentGroupResponse)
def update_agent_group(
    group_id: int,
    req: AgentGroupUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ag = (
        db.query(AgentGroup)
        .filter(AgentGroup.id == group_id, AgentGroup.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not ag:
        raise HTTPException(status_code=404, detail="Agent group not found")

    if req.name is not None:
        ag.name = req.name
    if req.description is not None:
        ag.description = req.description

    db.commit()
    db.refresh(ag)
    resp = AgentGroupResponse.model_validate(ag)
    resp.member_count = len(ag.members)
    return resp


@router.delete("/{group_id}")
def delete_agent_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ag = (
        db.query(AgentGroup)
        .filter(AgentGroup.id == group_id, AgentGroup.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not ag:
        raise HTTPException(status_code=404, detail="Agent group not found")

    db.delete(ag)
    db.commit()
    return {"detail": "Agent group deleted"}


# --- Members ---

@router.post("/{group_id}/members")
def add_member(
    group_id: int,
    target_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ag = (
        db.query(AgentGroup)
        .filter(AgentGroup.id == group_id, AgentGroup.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not ag:
        raise HTTPException(status_code=404, detail="Agent group not found")

    target = (
        db.query(DeploymentTarget)
        .filter(DeploymentTarget.id == target_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    existing = (
        db.query(AgentGroupMember)
        .filter(
            AgentGroupMember.agent_group_id == group_id,
            AgentGroupMember.target_id == target_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Agent is already a member of this group")

    member = AgentGroupMember(agent_group_id=group_id, target_id=target_id)
    db.add(member)
    db.commit()

    # Propagate existing group certificate assignments to the new member
    _sync_certificates_to_target(db, group_id, target_id)

    return {"detail": "Agent added to group"}


@router.delete("/{group_id}/members/{target_id}")
def remove_member(
    group_id: int,
    target_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ag = (
        db.query(AgentGroup)
        .filter(AgentGroup.id == group_id, AgentGroup.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not ag:
        raise HTTPException(status_code=404, detail="Agent group not found")

    member = (
        db.query(AgentGroupMember)
        .filter(
            AgentGroupMember.agent_group_id == group_id,
            AgentGroupMember.target_id == target_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    db.delete(member)
    db.commit()
    return {"detail": "Agent removed from group"}


# --- Certificate assignment to group ---

@router.post("/{group_id}/certificates")
def assign_certificate_to_group(
    group_id: int,
    req: AgentGroupAssignCertificate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ag = (
        db.query(AgentGroup)
        .filter(AgentGroup.id == group_id, AgentGroup.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not ag:
        raise HTTPException(status_code=404, detail="Agent group not found")

    if not req.certificate_id and not req.self_signed_certificate_id:
        raise HTTPException(status_code=400, detail="Provide certificate_id or self_signed_certificate_id")

    if req.certificate_id and req.self_signed_certificate_id:
        raise HTTPException(status_code=400, detail="Provide only one of certificate_id or self_signed_certificate_id")

    # Validate cert exists
    cert = None
    ss_cert = None
    if req.certificate_id:
        cert = db.query(Certificate).filter(Certificate.id == req.certificate_id).first()
        if not cert:
            raise HTTPException(status_code=400, detail="Certificate not found")
    else:
        ss_cert = db.query(SelfSignedCertificate).filter(
            SelfSignedCertificate.id == req.self_signed_certificate_id
        ).first()
        if not ss_cert:
            raise HTTPException(status_code=400, detail="Self-signed certificate not found")

    assigned_count = 0
    skipped_count = 0

    for member in ag.members:
        target_id = member.target_id

        # Check if already assigned
        if req.certificate_id:
            existing = (
                db.query(AgentCertificate)
                .filter(
                    AgentCertificate.target_id == target_id,
                    AgentCertificate.certificate_id == req.certificate_id,
                )
                .first()
            )
        else:
            existing = (
                db.query(AgentCertificate)
                .filter(
                    AgentCertificate.target_id == target_id,
                    AgentCertificate.self_signed_certificate_id == req.self_signed_certificate_id,
                )
                .first()
            )

        if existing:
            skipped_count += 1
            continue

        ac = AgentCertificate(
            target_id=target_id,
            certificate_id=req.certificate_id,
            self_signed_certificate_id=req.self_signed_certificate_id,
            auto_deploy=req.auto_deploy,
            deploy_format=req.deploy_format,
        )
        db.add(ac)

        # Auto-create pending deployment
        if req.auto_deploy:
            should_deploy = False
            if cert and cert.status == "valid":
                should_deploy = True
            elif ss_cert and ss_cert.certificate_pem:
                should_deploy = True

            if should_deploy:
                deployment = CertificateDeployment(
                    certificate_id=req.certificate_id,
                    self_signed_certificate_id=req.self_signed_certificate_id,
                    target_id=target_id,
                    deploy_format=req.deploy_format,
                    status="pending",
                )
                db.add(deployment)

        assigned_count += 1

    db.commit()

    return {
        "detail": f"Certificate assigned to {assigned_count} agent(s)",
        "assigned": assigned_count,
        "skipped": skipped_count,
    }


def _sync_certificates_to_target(db: Session, group_id: int, target_id: int):
    """When a new agent joins a group, give it the same certs as other group members."""
    # Find all certificates assigned to any other member of this group
    other_members = (
        db.query(AgentGroupMember)
        .filter(
            AgentGroupMember.agent_group_id == group_id,
            AgentGroupMember.target_id != target_id,
        )
        .all()
    )
    if not other_members:
        return

    # Use the first other member as the reference
    ref_target_id = other_members[0].target_id
    ref_assignments = (
        db.query(AgentCertificate)
        .filter(AgentCertificate.target_id == ref_target_id)
        .all()
    )

    for ref_ac in ref_assignments:
        # Check not already assigned
        if ref_ac.certificate_id:
            existing = (
                db.query(AgentCertificate)
                .filter(
                    AgentCertificate.target_id == target_id,
                    AgentCertificate.certificate_id == ref_ac.certificate_id,
                )
                .first()
            )
        elif ref_ac.self_signed_certificate_id:
            existing = (
                db.query(AgentCertificate)
                .filter(
                    AgentCertificate.target_id == target_id,
                    AgentCertificate.self_signed_certificate_id == ref_ac.self_signed_certificate_id,
                )
                .first()
            )
        else:
            continue

        if existing:
            continue

        ac = AgentCertificate(
            target_id=target_id,
            certificate_id=ref_ac.certificate_id,
            self_signed_certificate_id=ref_ac.self_signed_certificate_id,
            auto_deploy=ref_ac.auto_deploy,
            deploy_format=ref_ac.deploy_format,
        )
        db.add(ac)

        # Auto-create pending deployment
        if ref_ac.auto_deploy:
            should_deploy = False
            if ref_ac.certificate_id and ref_ac.certificate and ref_ac.certificate.status == "valid":
                should_deploy = True
            elif ref_ac.self_signed_certificate_id and ref_ac.self_signed_certificate and ref_ac.self_signed_certificate.certificate_pem:
                should_deploy = True

            if should_deploy:
                deployment = CertificateDeployment(
                    certificate_id=ref_ac.certificate_id,
                    self_signed_certificate_id=ref_ac.self_signed_certificate_id,
                    target_id=target_id,
                    deploy_format=ref_ac.deploy_format,
                    status="pending",
                )
                db.add(deployment)

    db.commit()
