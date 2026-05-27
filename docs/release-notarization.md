# Release notarization

Use these values when building a notarized macOS release:

```bash
export APPLE_ID="wuwangzhang1216@gmail.com"
export APPLE_TEAM_ID="46KF5Z549N"
export APPLE_PASSWORD="<Apple app-specific password>"
npm run build:desktop
```

Do not commit the app-specific password in plaintext. Generate it from the
Apple ID account security page when needed, and revoke it after release if it
has been shared outside a local shell session.
