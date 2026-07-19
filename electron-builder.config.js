import { brandConfig, companionName } from './brand.config.js'

export default {
  appId: 'app.beatfiend.companion',
  productName: companionName,
  artifactName: 'Beat-Fiend-Companion-Setup.exe',
  asar: true,
  files: [
    'brand.config.js',
    'companion/**/*',
    'desktop/**/*',
    'package.json',
  ],
  win: {
    target: ['nsis'],
    ...(brandConfig.companion.iconIco ? { icon: brandConfig.companion.iconIco } : {}),
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
  },
  publish: {
    provider: 'github',
    owner: 'Soleone',
    repo: 'beatfiend',
    releaseType: 'release',
  },
  directories: {
    output: 'release',
  },
}
