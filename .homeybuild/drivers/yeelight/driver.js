'use strict';

const Homey = require('homey');
const Util = require('../../lib/util.js');
const { getCapabilitiesForModel, getIconForModel } = require('../../lib/yeelight-models.js');

class YeelightDriver extends Homey.Driver {
  onInit() {
    if (!this.util) this.util = new Util({ homey: this.homey });
  }

  async onPairListDevices() {
    try {
      let devices = [];
      await this.util.fillAddedDevices();
      let result = await this.util.discover();
      
      if (!result || Object.keys(result).length === 0) {
        this.homey.app.log('[YeelightDriver] No devices discovered during pairing.');
        return devices; // Return an empty array if no devices are found
      }
      
      // for device identification purposes

      this.homey.app.log('Discovered devices:', result);

      for (let i in result) {

        var name = '';

        if (result[i].model.startsWith('color')) {
          if (result[i].model === 'colorc') {
            var name = this.homey.__('driver.yeelight_gu10') + ' (' + result[i].address + ')';
          } else {
            var name = this.homey.__('driver.yeelight_bulb_color') + ' (' + result[i].address + ')';
          }
        } else if (result[i].model.startsWith('mono')) {
          var name = this.homey.__('driver.yeelight_bulb_white') + ' (' + result[i].address + ')';
        } else if (result[i].model == 'ct') {
          var name = this.homey.__('driver.yeelight_bulb_white') + ' (' + result[i].address + ')';
        } else if (result[i].model.startsWith('strip')) {
          var name = this.homey.__('driver.yeelight_led_strip') + ' (' + result[i].address + ')';
        } else if (result[i].model.startsWith('bslamp')) {
          var name = this.homey.__('driver.yeelight_bedside_lamp') + ' (' + result[i].address + ')';
        } else if (result[i].model.startsWith('ceiling')) {
          if (result[i].model == 'ceiling' || result[i].model == 'ceiling1' || result[i].model == 'ceiling2' || result[i].model == 'ceiling3') {
            var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
          } else if (result[i].model == 'ceiling4') {
            var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
          } else if (result[i].model == 'ceiling5') {
            var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
          } else if (result[i].model == 'ceiling6' || result[i].model == 'ceiling7' || result[i].model == 'ceiling8' || result[i].model == 'ceiling9') {
            var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
          } else if (result[i].model == 'ceiling10') {
            var name = this.homey.__('driver.yeelight_meteorite_light') + ' (' + result[i].address + ')';
          } else if (result[i].model == 'ceiling15') {
            var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
          } else if (result[i].model == 'ceiling20') {
            var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
          } else {
            var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
          }
        } else if (result[i].model == 'ceilc') {
          var name = this.homey.__('driver.yeelight_ceiling_light') + ' (' + result[i].address + ')';
        } else if (result[i].model.startsWith('desklamp')) {
          var name = this.homey.__('yeelight_desklamp') + ' (' + result[i].address + ')';
        } else if (result[i].model.startsWith('lamp')) {
          var name = this.homey.__('yeelight_desklamp') + ' (' + result[i].address + ')';
        } else {
          var name = 'Unknown model' + ' (' + result[i].model + ')';
        }
        devices.push({
          name: name,
          data: {
            id: result[i].id,
            model: result[i].model
          },
          settings: {
            address: result[i].address,
            port: result[i].port
          },
          capabilities: getCapabilitiesForModel(result[i].model),
          icon: getIconForModel(result[i].model)
        });
      }

      return devices;
    } catch (error) {
      this.homey.app.log('Error during pairing:', error);
      throw new Error(error);
    }
  }
}

module.exports = YeelightDriver;
