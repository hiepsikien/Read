import os

# Tests must not depend on the developer's .env. Environment variables take
# priority over the dotenv file in pydantic-settings, so setting them here —
# before app modules import and cache Settings — pins the auth mode.
os.environ["AUTH_DEV_MODE"] = "true"
os.environ["AUTH_DEV_SECRET"] = "test-secret"
os.environ["FIREBASE_PROJECT_ID"] = ""
os.environ["FIREBASE_CREDENTIALS_JSON"] = ""
os.environ["ADMIN_EMAILS"] = "admin@read.app"
os.environ["SEED_DEMO"] = "false"
