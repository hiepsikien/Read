# Firebase setup

Read uses Firebase Authentication for email/password identity. The Expo app
gets a Firebase ID token, and FastAPI verifies that token with Firebase Admin.
Roles (`reader`, `publisher`, `admin`) remain in PostgreSQL.

## 1. Create the Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) and create a
   project.
2. Open **Authentication → Sign-in method**.
3. Enable **Email/Password**. Do not enable Email link for this MVP.

## 2. Register the Expo client

This project uses the Firebase JavaScript SDK, including in Expo Go. Register a
**Web app** in **Project settings → General → Your apps**. You do not need
`GoogleService-Info.plist` or `google-services.json` for this email/password
setup.

Copy the four matching values from `firebaseConfig`:

```bash
cd apps/mobile
cp .env.example .env
```

Fill in:

```dotenv
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

`EXPO_PUBLIC_*` values are bundled into the app. Firebase client configuration
is not a server secret; access control must be enforced by Firebase Auth and
FastAPI.

## 3. Configure FastAPI verification

In Firebase Console, open **Project settings → Service accounts → Generate new
private key**.

1. Save the downloaded file as
   `apps/api/firebase-service-account.json`.
2. Never commit or send that file. It is ignored by Git.
3. Update the API environment:

```bash
cd apps/api
cp .env.example .env
```

Set:

```dotenv
AUTH_DEV_MODE=false
FIREBASE_PROJECT_ID=your-project
FIREBASE_CREDENTIALS_JSON=./firebase-service-account.json
ADMIN_EMAILS=your-admin-email@example.com
```

`ADMIN_EMAILS` promotes a matching authenticated email to the PostgreSQL
`admin` role when the API syncs the Firebase user.

## 4. Install and run

```bash
# API
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
cd apps/api
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000

# Mobile, in another terminal
cd apps/mobile
npm install
npx expo start -c
```

For a physical phone, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to the
computer's LAN address, for example `http://192.168.1.10:8000`.

## 5. First verification

1. Create an account from the mobile sign-up screen.
2. Confirm the user appears under **Firebase Authentication → Users**.
3. Confirm `/api/auth/me` returns the same email.
4. Sign in with an email listed in `ADMIN_EMAILS`; the mobile Library should
   show the **Admin** entry.
5. Restart Expo and verify the session restores.

## Troubleshooting

- **App still says local auth:** one or more `EXPO_PUBLIC_FIREBASE_*` values is
  missing. Restart Expo with `-c` after changing `.env`.
- **401 from FastAPI:** client and server likely use different Firebase project
  IDs, or the service-account JSON belongs to another project.
- **Firebase Admin credential error:** check that
  `FIREBASE_CREDENTIALS_JSON` is relative to `apps/api`, or use an absolute
  path.
- **Network request failed on a phone:** do not use `localhost`; use the
  computer's LAN IP and ensure FastAPI is reachable on port 8000.
