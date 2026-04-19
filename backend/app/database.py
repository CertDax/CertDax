from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_db():
    """Add missing columns/tables to an existing database."""
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    # --- Groups & multi-user migration ---
    if "groups" not in existing_tables:
        if _is_sqlite:
            pk_def = "id INTEGER PRIMARY KEY"
        else:
            pk_def = "id SERIAL PRIMARY KEY"
        with engine.begin() as conn:
            conn.execute(text(f"""
                CREATE TABLE groups (
                    {pk_def},
                    name VARCHAR(100) NOT NULL,
                    created_at TIMESTAMP NOT NULL
                )
            """))
            conn.execute(text(
                "INSERT INTO groups (id, name, created_at) VALUES (1, 'Default', CURRENT_TIMESTAMP)"
            ))

    if "users" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("users")}
        if "group_id" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN group_id INTEGER REFERENCES groups(id)"))
                conn.execute(text("UPDATE users SET group_id = 1 WHERE group_id IS NULL"))

    # Add group_id to resource tables
    for table_name in [
        "certificates", "certificate_authorities", "dns_providers",
        "deployment_targets", "self_signed_certificates",
    ]:
        if table_name in existing_tables:
            existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
            if "group_id" not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text(
                        f"ALTER TABLE {table_name} ADD COLUMN group_id INTEGER REFERENCES groups(id)"
                    ))
                    conn.execute(text(f"UPDATE {table_name} SET group_id = 1 WHERE group_id IS NULL"))

    # --- Existing migrations ---

    # --- Profile image & audit trail migration ---
    if "users" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("users")}
        if "profile_image" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN profile_image TEXT"))
        if "display_name" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN display_name VARCHAR(100)"))
        if "password_reset_token" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN password_reset_token VARCHAR(500)"))

    for table_name in ["certificates", "self_signed_certificates"]:
        if table_name in existing_tables:
            existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
            if "created_by_user_id" not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text(
                        f"ALTER TABLE {table_name} ADD COLUMN created_by_user_id INTEGER REFERENCES users(id)"
                    ))
            if "modified_by_user_id" not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text(
                        f"ALTER TABLE {table_name} ADD COLUMN modified_by_user_id INTEGER REFERENCES users(id)"
                    ))

    if "deployment_targets" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("deployment_targets")}
        migrations = [
            ("agent_os", "VARCHAR(50)"),
            ("agent_arch", "VARCHAR(50)"),
            ("agent_version", "VARCHAR(50)"),
            ("agent_ip", "VARCHAR(45)"),
            ("pre_deploy_script", "TEXT"),
            ("post_deploy_script", "TEXT"),
            ("os_type", "VARCHAR(10) DEFAULT 'linux'"),
            ("recent_logs", "TEXT"),
        ]
        with engine.begin() as conn:
            for col_name, col_type in migrations:
                if col_name not in existing_cols:
                    conn.execute(
                        text(f"ALTER TABLE deployment_targets ADD COLUMN {col_name} {col_type}")
                    )

    if "certificates" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("certificates")}
        if "custom_oids" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE certificates ADD COLUMN custom_oids TEXT"))

    if "self_signed_certificates" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("self_signed_certificates")}
        if "custom_oids" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE self_signed_certificates ADD COLUMN custom_oids TEXT"))

    if "agent_certificates" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("agent_certificates")}
        if "deploy_format" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE agent_certificates ADD COLUMN deploy_format VARCHAR(10) DEFAULT 'crt'")
                )
        if "self_signed_certificate_id" not in existing_cols:
            if _is_sqlite:
                # SQLite: recreate table to make certificate_id nullable
                with engine.begin() as conn:
                    conn.execute(text("""
                        CREATE TABLE agent_certificates_new (
                            id INTEGER PRIMARY KEY,
                            target_id INTEGER NOT NULL REFERENCES deployment_targets(id) ON DELETE CASCADE,
                            certificate_id INTEGER REFERENCES certificates(id) ON DELETE CASCADE,
                            self_signed_certificate_id INTEGER REFERENCES self_signed_certificates(id) ON DELETE CASCADE,
                            auto_deploy BOOLEAN DEFAULT TRUE,
                            deploy_format VARCHAR(10) DEFAULT 'crt',
                            created_at TIMESTAMP
                        )
                    """))
                    conn.execute(text("""
                        INSERT INTO agent_certificates_new (id, target_id, certificate_id, auto_deploy, deploy_format, created_at)
                        SELECT id, target_id, certificate_id, auto_deploy, deploy_format, created_at
                        FROM agent_certificates
                    """))
                    conn.execute(text("DROP TABLE agent_certificates"))
                    conn.execute(text("ALTER TABLE agent_certificates_new RENAME TO agent_certificates"))
            else:
                # PostgreSQL: just add the column and alter nullable
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE agent_certificates ADD COLUMN self_signed_certificate_id INTEGER REFERENCES self_signed_certificates(id) ON DELETE CASCADE"
                    ))
                    conn.execute(text(
                        "ALTER TABLE agent_certificates ALTER COLUMN certificate_id DROP NOT NULL"
                    ))

    if "certificate_deployments" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("certificate_deployments")}
        if "deploy_format" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE certificate_deployments ADD COLUMN deploy_format VARCHAR(10) DEFAULT 'crt'")
                )
        if "common_name" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE certificate_deployments ADD COLUMN common_name VARCHAR(255)")
                )
        if "self_signed_certificate_id" not in existing_cols:
            if _is_sqlite:
                # SQLite: recreate table to make certificate_id nullable
                with engine.begin() as conn:
                    conn.execute(text("""
                        CREATE TABLE certificate_deployments_new (
                            id INTEGER PRIMARY KEY,
                            certificate_id INTEGER REFERENCES certificates(id),
                            self_signed_certificate_id INTEGER REFERENCES self_signed_certificates(id),
                            target_id INTEGER NOT NULL REFERENCES deployment_targets(id),
                            common_name VARCHAR(255),
                            status VARCHAR(20) NOT NULL DEFAULT 'pending',
                            deploy_format VARCHAR(10) DEFAULT 'crt',
                            deployed_at TIMESTAMP,
                            error_message TEXT,
                            created_at TIMESTAMP NOT NULL
                        )
                    """))
                    conn.execute(text("""
                        INSERT INTO certificate_deployments_new (id, certificate_id, target_id, common_name, status, deploy_format, deployed_at, error_message, created_at)
                        SELECT id, certificate_id, target_id, common_name, status, deploy_format, deployed_at, error_message, created_at
                        FROM certificate_deployments
                    """))
                    conn.execute(text("DROP TABLE certificate_deployments"))
                    conn.execute(text("ALTER TABLE certificate_deployments_new RENAME TO certificate_deployments"))
            else:
                # PostgreSQL: just add the column and alter nullable
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE certificate_deployments ADD COLUMN self_signed_certificate_id INTEGER REFERENCES self_signed_certificates(id)"
                    ))
                    conn.execute(text(
                        "ALTER TABLE certificate_deployments ALTER COLUMN certificate_id DROP NOT NULL"
                    ))

    if "certificate_authorities" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("certificate_authorities")}
        for col_name, col_type in [("eab_kid", "VARCHAR(500)"), ("eab_hmac_key", "TEXT")]:
            if col_name not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE certificate_authorities ADD COLUMN {col_name} {col_type}"))

    # --- OIDC migration ---
    if "users" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("users")}
        if "oidc_sub" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN oidc_sub VARCHAR(255)"))
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_oidc_sub ON users(oidc_sub)"))

    # --- App settings timezone migration ---
    if "app_settings" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("app_settings")}
        if "timezone" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE app_settings ADD COLUMN timezone VARCHAR(100) DEFAULT 'UTC'"))
        if "api_base_url" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE app_settings ADD COLUMN api_base_url VARCHAR(500)"))

    # --- Auto-renewal & threshold migration ---
    if "certificates" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("certificates")}
        if "renewal_threshold_days" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE certificates ADD COLUMN renewal_threshold_days INTEGER"))

    if "self_signed_certificates" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("self_signed_certificates")}
        if "auto_renew" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE self_signed_certificates ADD COLUMN auto_renew BOOLEAN DEFAULT FALSE"))
        if "renewal_threshold_days" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE self_signed_certificates ADD COLUMN renewal_threshold_days INTEGER"))
        if "signed_by_ca_id" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE self_signed_certificates ADD COLUMN signed_by_ca_id INTEGER REFERENCES self_signed_certificates(id)"))

    # --- K8s operators migration ---
    if "k8s_operators" in existing_tables:
        existing_cols = {c["name"] for c in inspector.get_columns("k8s_operators")}
        if "recent_logs" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE k8s_operators ADD COLUMN recent_logs TEXT"))
        if "managed_certs_json" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE k8s_operators ADD COLUMN managed_certs_json TEXT"))
        if "api_key_id" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE k8s_operators ADD COLUMN api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL"))
        if "pending_cr_deletions" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE k8s_operators ADD COLUMN pending_cr_deletions TEXT"))
        if "pending_certificates" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE k8s_operators ADD COLUMN pending_certificates INTEGER DEFAULT 0"))
        if "available_namespaces_json" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE k8s_operators ADD COLUMN available_namespaces_json TEXT"))

    # --- K8s deployments table ---
    if "k8s_deployments" not in existing_tables:
        if _is_sqlite:
            pk_def = "id INTEGER PRIMARY KEY"
        else:
            pk_def = "id SERIAL PRIMARY KEY"
        with engine.begin() as conn:
            conn.execute(text(f"""
                CREATE TABLE k8s_deployments (
                    {pk_def},
                    operator_id INTEGER NOT NULL REFERENCES k8s_operators(id) ON DELETE CASCADE,
                    certificate_id INTEGER NOT NULL,
                    certificate_type VARCHAR(20) NOT NULL DEFAULT 'selfsigned',
                    secret_name VARCHAR(255) NOT NULL,
                    namespace VARCHAR(255) NOT NULL DEFAULT 'default',
                    sync_interval VARCHAR(20) NOT NULL DEFAULT '1h',
                    include_ca BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """))


    # --- Notifications table ---
    if "notifications" not in existing_tables:
        if _is_sqlite:
            pk_def = "id INTEGER PRIMARY KEY"
        else:
            pk_def = "id SERIAL PRIMARY KEY"
        with engine.begin() as conn:
            conn.execute(text(f"""
                CREATE TABLE notifications (
                    {pk_def},
                    group_id INTEGER REFERENCES groups(id),
                    type VARCHAR(50) NOT NULL,
                    resource_type VARCHAR(50) NOT NULL,
                    resource_id INTEGER,
                    title VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    actor VARCHAR(100) NOT NULL DEFAULT 'system',
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """))

    # --- Subject fields on certificates ---
    if "certificates" in existing_tables:
        cert_columns = {c["name"] for c in inspector.get_columns("certificates")}
        with engine.begin() as conn:
            if "country" not in cert_columns:
                conn.execute(text("ALTER TABLE certificates ADD COLUMN country VARCHAR(10)"))
            if "state" not in cert_columns:
                conn.execute(text("ALTER TABLE certificates ADD COLUMN state VARCHAR(100)"))
            if "locality" not in cert_columns:
                conn.execute(text("ALTER TABLE certificates ADD COLUMN locality VARCHAR(100)"))
            if "organization" not in cert_columns:
                conn.execute(text("ALTER TABLE certificates ADD COLUMN organization VARCHAR(200)"))
            if "organizational_unit" not in cert_columns:
                conn.execute(text("ALTER TABLE certificates ADD COLUMN organizational_unit VARCHAR(200)"))


def init_db():
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_db()
    _ensure_default_group()


def _ensure_default_group():
    """Ensure a default group exists (needed for seed data and fresh installs)."""
    from app.models.group import Group

    with SessionLocal() as db:
        if not db.query(Group).first():
            from datetime import datetime, timezone
            db.add(Group(name="Default", created_at=datetime.now(timezone.utc)))
            db.commit()
