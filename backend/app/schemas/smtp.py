from pydantic import BaseModel


class SmtpSettingsRequest(BaseModel):
    host: str
    port: int = 587
    username: str | None = None
    password: str | None = None
    use_tls: bool = True
    from_email: str
    from_name: str | None = None
    enabled: bool = False


class SmtpSettingsResponse(BaseModel):
    id: int
    host: str
    port: int
    username: str | None = None
    has_password: bool = False
    use_tls: bool
    from_email: str
    from_name: str | None = None
    enabled: bool

    model_config = {"from_attributes": True}


class SmtpTestRequest(BaseModel):
    recipient: str
