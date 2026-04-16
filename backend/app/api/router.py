from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.certificates import router as certificates_router
from app.api.providers import router as providers_router
from app.api.deployments import router as deployments_router
from app.api.agent import router as agent_router
from app.api.agents import router as agents_router
from app.api.agent_groups import router as agent_groups_router
from app.api.selfsigned import router as selfsigned_router
from app.api.users import router as users_router
from app.api.settings import router as settings_router
from app.api.oidc import router as oidc_router
from app.api.api_keys import router as api_keys_router
from app.api.k8s import router as k8s_router
from app.api.k8s_operator import router as k8s_operator_router
from app.api.k8s_operators import router as k8s_operators_router
from app.api.notifications import router as notifications_router
from app.api.setup import router as setup_router

api_router = APIRouter()
api_router.include_router(setup_router, prefix="/setup", tags=["setup"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(certificates_router, prefix="/certificates", tags=["certificates"])
api_router.include_router(providers_router, prefix="/providers", tags=["providers"])
api_router.include_router(deployments_router, prefix="/deployments", tags=["deployments"])
api_router.include_router(agent_router, prefix="/agent", tags=["agent"])
api_router.include_router(agents_router, prefix="/agents", tags=["agents"])
api_router.include_router(agent_groups_router, prefix="/agent-groups", tags=["agent-groups"])
api_router.include_router(selfsigned_router, prefix="/self-signed", tags=["self-signed"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
api_router.include_router(oidc_router, prefix="/oidc", tags=["oidc"])
api_router.include_router(api_keys_router, prefix="/api-keys", tags=["api-keys"])
api_router.include_router(k8s_router, prefix="/k8s", tags=["kubernetes"])
api_router.include_router(k8s_operator_router, prefix="/k8s-operator", tags=["k8s-operator"])
api_router.include_router(k8s_operators_router, prefix="/k8s-operators", tags=["k8s-operators"])
api_router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
