import { brandConfig, companionArtifactName, companionName } from './brand.config.js'

export default {
  appId: 'app.vibestep.companion',
  productName: companionName,
  artifactName: companionArtifactName,
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
    repo: 'vibestep',
    releaseType: 'release',
  },
  directories: {
    output: 'release',
  },
}
