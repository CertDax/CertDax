import bcrypt as _bcrypt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.group import Group
from app.models.group_share import GroupShare
from app.api.deps import require_admin
from app.schemas.auth import (
    CreateGroupRequest,
    CreateUserRequest,
    GroupResponse,
    UpdateUserRequest,
    UserResponse,
)
from app.schemas.group_share import (
    GroupShareCreate,
    GroupShareResponse,
    VALID_RESOURCE_TYPES,
)

router = APIRouter()


@router.get("", response_model=list[UserResponse])
def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    users = db.query(User).all()
    result = []
    groups_cache: dict[int, str | None] = {}
    for u in users:
        group_name = None
        if u.group_id:
            if u.group_id not in groups_cache:
                g = db.query(Group).filter(Group.id == u.group_id).first()
                groups_cache[u.group_id] = g.name if g else None
            group_name = groups_cache[u.group_id]
        result.append(
            UserResponse(
                id=u.id,
                username=u.username,
                display_name=u.display_name,
                email=u.email,
                is_admin=u.is_admin,
                group_id=u.group_id,
                group_name=group_name,
                profile_image=u.profile_image,
            )
        )
    return result


@router.post("", response_model=UserResponse, status_code=201)
def create_user(
    req: CreateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    if req.group_id:
        group = db.query(Group).filter(Group.id == req.group_id).first()
        if not group:
            raise HTTPException(status_code=400, detail="Group not found")

    pw_hash = _bcrypt.hashpw(req.password.encode(), _bcrypt.gensalt()).decode()
    user = User(
        username=req.username,
        email=req.email,
        password_hash=pw_hash,
        is_admin=req.is_admin,
        group_id=req.group_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    group_name = None
    if user.group_id:
        g = db.query(Group).filter(Group.id == user.group_id).first()
        group_name = g.name if g else None

    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        is_admin=user.is_admin,
        group_id=user.group_id,
        group_name=group_name,
        profile_image=user.profile_image,
    )


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    req: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.username is not None:
        existing = db.query(User).filter(User.username == req.username, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")
        user.username = req.username

    if req.email is not None:
        user.email = req.email

    if req.password is not None:
        user.password_hash = _bcrypt.hashpw(req.password.encode(), _bcrypt.gensalt()).decode()

    if req.is_admin is not None:
        if user.id == admin.id and not req.is_admin:
            raise HTTPException(status_code=400, detail="You cannot remove your own admin rights")
        user.is_admin = req.is_admin

    if req.group_id is not None:
        group = db.query(Group).filter(Group.id == req.group_id).first()
        if not group:
            raise HTTPException(status_code=400, detail="Group not found")
        user.group_id = req.group_id

    db.commit()
    db.refresh(user)

    group_name = None
    if user.group_id:
        g = db.query(Group).filter(Group.id == user.group_id).first()
        group_name = g.name if g else None

    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        is_admin=user.is_admin,
        group_id=user.group_id,
        group_name=group_name,
        profile_image=user.profile_image,
    )


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")

    db.delete(user)
    db.commit()


@router.get("/groups", response_model=list[GroupResponse])
def list_groups(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    groups = db.query(Group).all()
    return [
        GroupResponse(
            id=g.id,
            name=g.name,
            created_at=g.created_at.isoformat() if g.created_at else None,
        )
        for g in groups
    ]


@router.post("/groups", response_model=GroupResponse, status_code=201)
def create_group(
    req: CreateGroupRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.query(Group).filter(Group.name == req.name).first():
        raise HTTPException(status_code=400, detail="Group name already exists")

    group = Group(name=req.name)
    db.add(group)
    db.commit()
    db.refresh(group)

    return GroupResponse(
        id=group.id,
        name=group.name,
        created_at=group.created_at.isoformat() if group.created_at else None,
    )


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(
    group_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    users_in_group = db.query(User).filter(User.group_id == group_id).count()
    if users_in_group > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete group: there are still users in this group",
        )

    db.delete(group)
    db.commit()


# ── Group Shares ──────────────────────────────────────────────────────────────


@router.get("/groups/{group_id}/shares", response_model=list[GroupShareResponse])
def list_group_shares(
    group_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    shares = db.query(GroupShare).filter(GroupShare.owner_group_id == group_id).all()
    groups_cache: dict[int, str | None] = {}

    def _name(gid: int) -> str | None:
        if gid not in groups_cache:
            g = db.query(Group).filter(Group.id == gid).first()
            groups_cache[gid] = g.name if g else None
        return groups_cache[gid]

    return [
        GroupShareResponse(
            id=s.id,
            owner_group_id=s.owner_group_id,
            owner_group_name=_name(s.owner_group_id),
            target_group_id=s.target_group_id,
            target_group_name=_name(s.target_group_id),
            resource_type=s.resource_type,
            created_at=s.created_at.isoformat() if s.created_at else None,
        )
        for s in shares
    ]


@router.post("/groups/{group_id}/shares", response_model=GroupShareResponse, status_code=201)
def create_group_share(
    group_id: int,
    req: GroupShareCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if req.resource_type not in VALID_RESOURCE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid resource type. Choose from: {', '.join(VALID_RESOURCE_TYPES)}",
        )

    owner = db.query(Group).filter(Group.id == group_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Source group not found")

    target = db.query(Group).filter(Group.id == req.target_group_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target group not found")

    if group_id == req.target_group_id:
        raise HTTPException(status_code=400, detail="Cannot share with the same group")

    existing = (
        db.query(GroupShare)
        .filter(
            GroupShare.owner_group_id == group_id,
            GroupShare.target_group_id == req.target_group_id,
            GroupShare.resource_type == req.resource_type,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This share already exists")

    share = GroupShare(
        owner_group_id=group_id,
        target_group_id=req.target_group_id,
        resource_type=req.resource_type,
    )
    db.add(share)
    db.commit()
    db.refresh(share)

    return GroupShareResponse(
        id=share.id,
        owner_group_id=share.owner_group_id,
        owner_group_name=owner.name,
        target_group_id=share.target_group_id,
        target_group_name=target.name,
        resource_type=share.resource_type,
        created_at=share.created_at.isoformat() if share.created_at else None,
    )


@router.delete("/groups/{group_id}/shares/{share_id}", status_code=204)
def delete_group_share(
    group_id: int,
    share_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    share = (
        db.query(GroupShare)
        .filter(GroupShare.id == share_id, GroupShare.owner_group_id == group_id)
        .first()
    )
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    db.delete(share)
    db.commit()
