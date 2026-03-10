'use strict';

const typeCapabilityMap = {
  mono: ['onoff', 'dim'],
  mono1: ['onoff', 'dim'],
  color: ['onoff', 'dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode'],
  colorc: ['onoff', 'dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode'],
  stripe: ['onoff', 'dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode'],
  ct: ['onoff', 'dim', 'light_temperature'],
  bslamp: ['onoff', 'dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode'],
  bslamp1: ['onoff', 'dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode'],
  bslamp2: ['onoff', 'dim', 'light_hue', 'light_saturation', 'light_temperature', 'light_mode'],
  ceiling: ['onoff', 'dim', 'light_temperature', 'light_mode', 'night_mode'],
  ceiling4: ['onoff', 'onoff.bg', 'dim', 'dim.bg', 'light_hue', 'light_saturation', 'light_temperature', 'light_temperature.bg', 'light_mode', 'light_mode.bg', 'night_mode'],
  ceilc: ['onoff', 'onoff.bg', 'dim', 'dim.bg', 'light_hue', 'light_saturation', 'light_temperature', 'light_temperature.bg', 'light_mode', 'light_mode.bg', 'night_mode'],
  'ceiling5+': ['onoff', 'onoff.bg', 'dim', 'dim.bg', 'light_hue', 'light_saturation', 'light_temperature', 'light_temperature.bg', 'light_mode', 'light_mode.bg', 'night_mode'],
  ceiling5: ['onoff', 'dim', 'light_temperature', 'light_mode', 'night_mode'],
  ceiling6: ['onoff', 'dim', 'light_temperature', 'light_mode', 'night_mode'],
  ceiling10: ['onoff', 'onoff.bg', 'dim', 'dim.bg', 'light_hue', 'light_saturation', 'light_temperature', 'light_temperature.bg', 'light_mode', 'light_mode.bg', 'night_mode'],
  ceiling15: ['onoff', 'dim', 'light_temperature', 'light_mode', 'night_mode'],
  ceiling20: ['onoff', 'onoff.bg', 'dim', 'dim.bg', 'light_hue', 'light_saturation', 'light_temperature', 'light_temperature.bg', 'light_mode', 'light_mode.bg', 'night_mode'],
  desklamp: ['onoff', 'dim', 'light_temperature'],
  lamp: ['onoff', 'dim', 'light_temperature'],
  lamp15: ['onoff', 'onoff.bg', 'dim', 'dim.bg', 'light_hue', 'light_saturation', 'light_temperature', 'light_temperature.bg', 'light_mode', 'light_mode.bg', 'night_mode']
};

const typeIconMap = {
  mono: 'bulb.svg',
  mono1: 'bulb.svg',
  color: 'bulb.svg',
  colorc: 'gu10.svg',
  stripe: 'strip.svg',
  ct: 'bulb.svg',
  bslamp: 'bslamp.svg',
  bslamp1: 'bslamp.svg',
  bslamp2: 'bslamp2.svg',
  ceiling: 'ceiling.svg',
  ceiling4: 'ceiling4.svg',
  ceilc: 'ceiling4.svg',
  'ceiling5+': 'ceiling.svg',
  ceiling5: 'ceiling.svg',
  ceiling6: 'ceiling.svg',
  ceiling10: 'ceiling10.svg',
  ceiling15: 'ceiling4.svg',
  ceiling20: 'ceiling4.svg',
  desklamp: 'desklamp.svg',
  lamp: 'desklamp.svg',
  lamp15: 'desklamp.svg'
};

function getPairingType(rawModel) {
  if (!rawModel) {
    return 'ceiling';
  }

  if (rawModel.startsWith('color')) {
    return rawModel === 'colorc' ? 'colorc' : 'color';
  }

  if (rawModel.startsWith('mono')) {
    return rawModel === 'mono1' ? 'mono1' : 'mono';
  }

  if (rawModel === 'ct') {
    return 'ct';
  }

  if (rawModel.startsWith('strip')) {
    return 'stripe';
  }

  if (rawModel.startsWith('bslamp')) {
    return rawModel === 'bslamp2' ? 'bslamp2' : 'bslamp';
  }

  if (rawModel.startsWith('ceiling')) {
    if (['ceiling', 'ceiling1', 'ceiling2', 'ceiling3'].includes(rawModel)) {
      return 'ceiling';
    }

    if (['ceiling4', 'ceiling5', 'ceiling6', 'ceiling10', 'ceiling15', 'ceiling20'].includes(rawModel)) {
      return rawModel;
    }

    if (['ceiling7', 'ceiling8', 'ceiling9'].includes(rawModel)) {
      return 'ceiling5+';
    }

    return 'ceiling';
  }

  if (rawModel === 'ceilc') {
    return 'ceilc';
  }

  if (rawModel.startsWith('desklamp')) {
    return 'desklamp';
  }

  if (rawModel.startsWith('lamp')) {
    return rawModel === 'lamp15' ? 'lamp15' : 'lamp';
  }

  return 'ceiling';
}

function getCapabilitiesForModel(rawModel) {
  const pairingType = getPairingType(rawModel);
  return typeCapabilityMap[pairingType] || typeCapabilityMap.ceiling;
}

function getIconForModel(rawModel) {
  const pairingType = getPairingType(rawModel);
  return typeIconMap[pairingType] || typeIconMap.ceiling;
}

module.exports = {
  getCapabilitiesForModel,
  getIconForModel,
  getPairingType,
  typeCapabilityMap,
  typeIconMap
};
