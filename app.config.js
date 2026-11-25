// app.config.js
// T1.9BW: Expo reads app.json first and passes it in as `config`; this file only adds what must
// not live in git. Android push needs Firebase's google-services.json: on EAS it comes from the
// file variable GOOGLE_SERVICES_JSON, locally from ./google-services.json when that file exists
// (it is in .gitignore). Without either, the build still works, but Android gets no push.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const local = path.join(__dirname, "google-services.json");
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? "./google-services.json" : undefined);
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
