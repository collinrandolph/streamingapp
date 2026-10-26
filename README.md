# streamingapp

A personal, self-hosted tracker for what you watch across streaming services, with a phone web app that opens titles on your Roku.

The design lives in two places:

- Build spec: https://claude.ai/artifact/Hq1wjq1RPtgDkYoinNhpcJ
- Phone app prototype: https://claude.ai/artifact/USj53nG8Ky2mwV6rjTnjxf

## M0: checks before building

**Roku launch test** (`tools/roku/roku.js`, Node only, no packages):

```bash
node tools/roku/roku.js <roku-ip> info
node tools/roku/roku.js <roku-ip> apps
node tools/roku/roku.js <roku-ip> launch <appId>
node tools/roku/roku.js <roku-ip> launch <appId> <contentId> <mediaType>
```

The Roku needs **Settings › System › Advanced system settings › Control by mobile apps** turned on.

Secrets such as API keys go in `*.local.json` files, which git ignores.
