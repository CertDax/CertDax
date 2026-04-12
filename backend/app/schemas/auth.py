from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str | None = None
    email: str
    is_admin: bool
    group_id: int | None = None
    group_name: str | None = None
    profile_image: str | None = None

    model_config = {"from_attributes": True}


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    password: str | None = None
    profile_image: str | None = None


class CreateUserRequest(BaseModel):
    username: str
    email: str
    password: str
    is_admin: bool = False
    group_id: int | None = None


class UpdateUserRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str | None = None
    is_admin: bool | None = None
    group_id: int | None = None


class GroupResponse(BaseModel):
    id: int
    name: str
    created_at: str | None = None

    model_config = {"from_attributes": True}


class CreateGroupRequest(BaseModel):
    name: str
