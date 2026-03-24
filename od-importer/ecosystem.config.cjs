module.exports = {
  apps: [
    {
      name: "od-importer",
      cwd: "C:/Users/User/Excel-Db/od-importer",
      script: "dist/src/server.js",
      interpreter: "node",
      env: {
        OD_ENV_PATH: "C:/Users/User/Excel-Db/od-importer/.env",
        NODE_ENV: "production"
      },
      autorestart: true,
      watch: false,
      max_restarts: 20,
      restart_delay: 3000,
      out_file: "C:/Users/User/Excel-Db/od-importer/server-out.log",
      error_file: "C:/Users/User/Excel-Db/od-importer/server-err.log",
      time: true
    }
  ]
};
