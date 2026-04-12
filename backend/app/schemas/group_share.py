from pydantic import BaseModel


VALID_RESOURCE_TYPES = [
    "certificates",
    "self_signed",
    "agents",
    "providers",
]


class GroupShareCreate(BaseModel):
    target_group_id: int
    resource_type: str


class GroupShareResponse(BaseModel):
    id: int
    owner_group_id: int
    owner_group_name: str | None = None
    target_group_id: int
    target_group_name: str | None = None
    resource_type: str
    created_at: str | None = None

    model_config = {"from_attributes": True}
