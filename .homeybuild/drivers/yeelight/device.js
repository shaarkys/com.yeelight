'use strict';

const Homey = require('homey');
const net = require('net');
const tinycolor = require('tinycolor2');
const Util = require('../../lib/util.js');

class YeelightDevice extends Homey.Device {
  async onInit() {
    if (!this.util) this.util = new Util({ homey: this.homey });

    // Initialize dimMinTime and dimMaxTime
    this.dimMinTime = 0;
    this.dimMaxTime = 0;

    /* Initialize buffer to accumulate incoming data */
    this.buffer = '';
    this.updateAddedDevicesTimeout = null;
    this.getPropTimeout = null;

    /* update the paired devices list when a device is initialized */
    this.updateAddedDevicesTimeout = this.homey.setTimeout(async () => {
      await this.util.fillAddedDevices();
    }, 2000);

    this.data = this.getData();
    this.socket = null;
    this.reconnect = null;
    this.connecting = false;
    this.connected = false;

    await this.setAvailable();

    this.createDeviceSocket();

    // LISTENERS FOR UPDATING CAPABILITIES
    /*    this.registerCapabilityListener('onoff', async (value) => {
      const action = value ? 'on' : 'off';
      return await this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["' + action + '", "smooth", 500]}');
    });*/

    // When turning the light on, check the night_mode state
    this.registerCapabilityListener('onoff', async (value) => {
      if (!value) {
        // Turning off as usual
        return await this.sendCommand(this.getData().id, `{"id":1,"method":"set_power","params":["off","smooth",500]}`);
      } else {
        // Turning on
        const nightMode = this.getCapabilityValue('night_mode');
        const modeParam = nightMode ? ',5' : '';
        return await this.sendCommand(this.getData().id, `{"id":1,"method":"set_power","params":["on","smooth",500${modeParam}]}`);
      }
    });

    this.registerCapabilityListener('onoff.bg', async (value) => {
      const action = value ? 'on' : 'off';
      return await this.sendCommand(this.getData().id, '{"id": 1, "method": "bg_set_power", "params":["' + action + '", "smooth", 500]}');
    });

    this.registerCapabilityListener('dim', async (value, opts) => {
      try {
        opts = opts || {};
        let brightness = value === 0 ? 1 : value * 100;
        // Logic which will toggle between night_mode and normal_mode when brightness is set to 0 or 100 two times within 5 seconds
        if (this.hasCapability('night_mode') && opts.duration === undefined) {
          if (value === 0) {
            if (this.dimMinTime + 5000 > Date.now()) {
              await this.triggerCapabilityListener('night_mode', true);
              if (this.getCapabilityValue('night_mode') === false) {
                brightness = 100;
              }
              this.dimMinTime = 0;
            } else {
              this.dimMinTime = Date.now();
            }
          } else if (value === 1) {
            if (this.dimMaxTime + 5000 > Date.now()) {
              await this.triggerCapabilityListener('night_mode', false);
              if (this.getCapabilityValue('night_mode') === true) {
                brightness = 1;
              }
              this.dimMaxTime = 0;
            } else {
              this.dimMaxTime = Date.now();
            }
          } else {
            this.dimMinTime = 0;
            this.dimMaxTime = 0;
          }
        }

        if (typeof opts.duration === 'undefined') {
          opts.duration = 500;
        }

        if (value === 0 && !this.hasCapability('night_mode')) {
          return await this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["off", "smooth", 500]}');
        } else if (value === 0) {
          if (this.getData().model === 'color') {
            var color_temp = this.util.denormalize(this.getCapabilityValue('light_temperature'), 1700, 6500);
          } else if (this.getData().model === 'lamp') {
            var color_temp = this.util.denormalize(this.getCapabilityValue('light_temperature'), 2600, 5000);
          } else {
            var color_temp = this.util.denormalize(this.getCapabilityValue('light_temperature'), 2700, 6500);
          }
          return await this.sendCommand(this.getData().id, '{"id":1,"method":"start_cf","params":[1, 2, "' + opts.duration + ', 2, ' + color_temp + ', 0"]}');
        } else {
          return await this.sendCommand(this.getData().id, '{"id":1,"method":"set_bright","params":[' + brightness + ', "smooth", ' + opts.duration + ']}');
        }
      } catch (error) {
        return Promise.reject(error);
      }
    });

    this.registerCapabilityListener('dim.bg', async (value, opts) => {
      try {
        opts = opts || {};
        if (typeof opts.duration === 'undefined') {
          opts.duration = 500;
        }
        let brightness = value === 0 ? 1 : value * 100;
        return await this.sendCommand(this.getData().id, '{"id":1,"method":"bg_set_bright","params":[' + brightness + ', "smooth", ' + opts.duration + ']}');
      } catch (error) {
        return Promise.reject(error);
      }
    });

    /*this.registerCapabilityListener('night_mode', async (value) => {
      const action = value ? '5' : '1';
      return await this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["on", "smooth", 500, ' + action + ']}');
    });*/

    // Store desired night mode state when off without sending command
    this.registerCapabilityListener('night_mode', async (value) => {
      const currentPower = this.getCapabilityValue('onoff');

      if (currentPower) {
        // Light is on, directly apply night mode by turning it on with mode=5 or reverting to mode=1
        const action = value ? '5' : '1';
        return await this.sendCommand(this.getData().id, `{"id":1,"method":"set_power","params":["on","smooth",500,${action}]}`);
      } else {
        // Light is off, just store the desired state. Actual mode will be applied when turning the light on.
        return true;
      }
    });

    this.registerMultipleCapabilityListener(
      ['light_hue', 'light_saturation'],
      async (valueObj, optsObj) => {
        try {
          if (!this.getCapabilityValue('onoff')) {
            await this.triggerCapabilityListener('onoff', true).catch((err) => this.error('Error triggering "onoff":', err));
          }

          let hue = typeof valueObj.light_hue !== 'undefined' ? Math.round(valueObj.light_hue * 359) : Math.round((await this.getCapabilityValue('light_hue')) * 359);

          let saturation = typeof valueObj.light_saturation !== 'undefined' ? Math.round(valueObj.light_saturation * 100) : Math.round((await this.getCapabilityValue('light_saturation')) * 100);

          if (this.getData().model === 'ceiling4' || this.getData().model === 'ceiling10' || this.getData().model === 'ceiling20') {
            return await this.sendCommand(this.getData().id, '{"id":1,"method":"bg_set_hsv","params":[' + hue + ',' + saturation + ', "smooth", 500]}');
          } else {
            return await this.sendCommand(this.getData().id, '{"id":1,"method":"set_hsv","params":[' + hue + ',' + saturation + ', "smooth", 500]}');
          }
        } catch (error) {
          return Promise.reject(error);
        }
      },
      500
    );

    this.registerCapabilityListener('light_temperature', async (value) => {
      try {
        if (!this.getCapabilityValue('onoff')) {
          await this.triggerCapabilityListener('onoff', true).catch((err) => this.error('Error triggering "onoff":', err));
        }

        let color_temp;
        if (this.getData().model === 'color') {
          color_temp = this.util.denormalize(value, 1700, 6500);
        } else if (this.getData().model === 'lamp') {
          color_temp = this.util.denormalize(value, 2600, 5000);
        } else {
          color_temp = this.util.denormalize(value, 2700, 6500);
        }
        /*
        if (this.hasCapability('night_mode')) {
          this.setCapabilityValue('night_mode', false).catch((err) => this.error('Error setting "night_mode":', err));
        }*/
        return await this.sendCommand(this.getData().id, '{"id":1,"method":"set_ct_abx","params":[' + color_temp + ', "smooth", 500]}');
      } catch (error) {
        return Promise.reject(error);
      }
    });

    this.registerCapabilityListener('light_temperature.bg', async (value) => {
      try {
        if (!this.getCapabilityValue('onoff.bg')) {
          await this.triggerCapabilityListener('onoff.bg', true).catch((err) => this.error('Error triggering "onoff.bg":', err));
        }
        const color_temp = this.util.denormalize(value, 2700, 6500);
        return await this.sendCommand(this.getData().id, '{"id":1,"method":"bg_set_ct_abx","params":[' + color_temp + ', "smooth", 500]}');
      } catch (error) {
        return Promise.reject(error);
      }
    });

    this.registerCapabilityListener('light_mode', async (value) => {
      return Promise.resolve(true);
    });
  }

  async onDeleted() {
    try {
      this.homey.clearTimeout(this.reconnect);
      this.homey.clearTimeout(this.updateAddedDevicesTimeout);
      this.homey.clearTimeout(this.getPropTimeout);
      if (this.socket) {
        this.socket.destroy();
      }
    } catch (error) {
      this.error(error);
    }
  }

  async onUninit() {
    try {
      this.homey.clearTimeout(this.reconnect);
      this.homey.clearTimeout(this.updateAddedDevicesTimeout);
      this.homey.clearTimeout(this.getPropTimeout);
      if (this.socket) {
        this.socket.destroy();
      }
    } catch (error) {
      this.error(error);
    }
  }

  // HELPER FUNCTIONS

  createDeviceSocket() {
    try {
      if (this.socket === null && this.connecting === false && this.connected === false) {
        this.connecting = true;
        this.socket = new net.Socket();
        this.socket.connect(this.getSetting('port'), this.getSetting('address'), () => {
          this.socket.setKeepAlive(true, 5000);
          this.socket.setTimeout(0);
        });
      } else {
        this.homey.app.log('Yeelight - trying to create socket, but connection not cleaned up previously.');
        return;
      }
    } catch (error) {
      this.homey.app.log('Yeelight - error creating socket: ' + error);
      return;
    }

    if (!this.socket) {
      return;
    }

    this.socket.on('connect', async () => {
      this.connecting = false;
      this.connected = true;

      if (!this.getAvailable()) {
        try {
          await this.setAvailable();
          // **Trigger Device-Specific Flow Trigger: device_becomes_available**
          const deviceAvailableTrigger = this.homey.flow.getDeviceTriggerCard('device_becomes_available');
          deviceAvailableTrigger
            .trigger(this, {}, {})
            .then(() => {
              this.homey.app.log(`${this.getName()} - Flow triggered: device_becomes_available`);
            })
            .catch((err) => {
              this.error('Error triggering device_becomes_available:', err);
            });
          this.homey.app.log(`${this.getName()} - marked as available`);
        } catch (err) {
          this.error('Error setting device available:', err);
        }
      }

      /* get current light status 4 seconds after connection */
      this.homey.clearTimeout(this.getPropTimeout);
      this.getPropTimeout = this.homey.setTimeout(() => {
        if (this.socket !== null) {
          this.socket.write('{"id":1,"method":"get_prop","params":["power", "bright", "color_mode", "ct", "rgb", "hue", "sat"]}' + '\r\n');
        }
      }, 4000);
    });

    this.socket.on('error', (error) => {
      this.homey.app.log(`${this.getName()} - socket error: ${error}`);
      this.connected = false;

      if (this.socket) {
        this.socket.destroy();
      }

      let time2retry;
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.message === 'Error sending command') {
        this.homey.app.log(`${this.getName()} - trying to reconnect in 6 seconds.`);
        time2retry = 6000;
      } else {
        this.homey.app.log(`${this.getName()} - trying to reconnect in 60 seconds.`);
        time2retry = 60000;
      }

      if (this.reconnect === null) {
        this.reconnect = this.homey.setTimeout(() => {
          if (typeof this.connecting !== 'undefined' && typeof this.connected !== 'undefined') {
            if (this.connecting === false && this.connected === false) {
              this.createDeviceSocket();
            }
          }
          this.reconnect = null;
        }, time2retry);
      }
    });

    this.socket.on('close', async (had_error) => {
      try {
        this.connecting = false;
        this.connected = false;
        this.socket = null;
        if (this.getAvailable()) {
          await this.setUnavailable(this.homey.__('device.unreachable'));
          // **Trigger Device-Specific Flow Trigger: device_becomes_unavailable**
          const deviceUnavailableTrigger = this.homey.flow.getDeviceTriggerCard('device_becomes_unavailable');
          deviceUnavailableTrigger
            .trigger(this, {}, {})
            .then(() => {
              this.homey.app.log(`${this.getName()} - Flow triggered: device_becomes_unavailable`);
            })
            .catch((error) => {
              this.error('Error triggering device_becomes_unavailable:', error);
            });
          this.homey.app.log(`${this.getName()} - marked as NOT available or still is NOT available`);
        }
      } catch (error) {
        this.error(error);
      }
    });

    this.socket.on('data', async (message, address) => {
      try {
        // Clear any existing reconnect timeout
        this.homey.clearTimeout(this.reconnect);
        this.reconnect = null;

        // Ensure the device is marked as available
        if (!this.getAvailable()) {
          try {
            await this.setAvailable();
            // **Trigger Device-Specific Flow Trigger: device_becomes_available**
            const deviceAvailableTrigger = this.homey.flow.getDeviceTriggerCard('device_becomes_available');
            deviceAvailableTrigger
              .trigger(this, {}, {})
              .then(() => {
                this.homey.app.log(`${this.getName()} - Flow triggered: device_becomes_available`);
              })
              .catch((err) => {
                this.error('Error triggering device_becomes_available:', err);
              });

            this.homey.app.log(`${this.getName()} - marked as available`);
          } catch (err) {
            this.error('Error setting device available:', err);
          }
        }

        // Append incoming message to buffer
        this.buffer += message.toString();

        if (this.buffer.length > 65536) {
          this.homey.app.log(`${this.getName()} - buffer exceeded 64KB, resetting.`);
          this.buffer = '';
        }

        // Remove 'ok' responses and carriage returns to simplify parsing
        this.buffer = this.buffer
          .replace(/{"id":1, "result":\["ok"\]}/g, '')
          .replace(/{"id":1,"result":\["ok"\]}/g, '')
          .replace(/\r\n/g, '');

        // Initialize variables for brace counting
        let startIndex = this.buffer.indexOf('{');
        while (startIndex !== -1) {
          let braceCount = 0;
          let endIndex = -1;

          // Iterate through the buffer to find the end of the first complete JSON object
          for (let i = startIndex; i < this.buffer.length; i++) {
            if (this.buffer[i] === '{') braceCount++;
            else if (this.buffer[i] === '}') braceCount--;

            // When braceCount returns to zero, we've found a complete JSON object
            if (braceCount === 0) {
              endIndex = i;
              break;
            }
          }

          // If a complete JSON object is found
          if (endIndex !== -1) {
            // Extract the complete JSON string
            const jsonString = this.buffer.substring(startIndex, endIndex + 1);

            // Remove the extracted JSON from the buffer
            this.buffer = this.buffer.substring(endIndex + 1);

            // Attempt to parse the JSON string
            try {
              const parsedJSON = JSON.parse(jsonString);

              // Determine the type of message and handle accordingly
              if (parsedJSON.method && parsedJSON.method === 'props') {
                // Handle 'props' messages
                for (const key in parsedJSON.params) {
                  switch (key) {
                    case 'power':
                      {
                        let onoff = parsedJSON.params.power === 'on';
                        if (this.getCapabilityValue('onoff') !== onoff) {
                          try {
                            await this.setCapabilityValue('onoff', onoff);
                          } catch (err) {
                            this.error('Error setting "onoff":', err);
                          }
                        }
                      }
                      break;
                    case 'main_power':
                      {
                        let main_power = parsedJSON.params.main_power === 'on';
                        if (this.getCapabilityValue('onoff') !== main_power) {
                          try {
                            await this.setCapabilityValue('onoff', main_power);
                          } catch (err) {
                            this.error('Error setting "onoff" for main_power:', err);
                          }
                        }
                      }
                      break;
                    case 'bg_power':
                      {
                        if (this.hasCapability('onoff.bg')) {
                          let bg_power = parsedJSON.params.bg_power === 'on';
                          if (this.getCapabilityValue('onoff.bg') !== bg_power) {
                            try {
                              await this.setCapabilityValue('onoff.bg', bg_power);
                            } catch (err) {
                              this.error('Error setting "onoff.bg":', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'bright':
                      {
                        var dim = parsedJSON.params.bright / 100;
                        if (this.getCapabilityValue('dim') !== dim) {
                          try {
                            await this.setCapabilityValue('dim', dim);
                          } catch (err) {
                            this.error('Error setting "dim":', err);
                          }
                        }
                      }
                      break;
                    case 'active_bright':
                      {
                        var active_dim = parsedJSON.params.active_bright / 100;
                        if (this.getCapabilityValue('dim') !== active_dim) {
                          try {
                            await this.setCapabilityValue('dim', active_dim);
                          } catch (err) {
                            this.error('Error setting "dim" from active_bright:', err);
                          }
                        }
                      }
                      break;
                    case 'bg_bright':
                      {
                        if (this.hasCapability('dim.bg')) {
                          var dim_bg = parsedJSON.params.bg_bright / 100;
                          if (this.getCapabilityValue('dim.bg') !== dim_bg) {
                            try {
                              await this.setCapabilityValue('dim.bg', dim_bg);
                            } catch (err) {
                              this.error('Error setting "dim.bg":', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'ct':
                      {
                        let color_temp;
                        if (this.getData().model === 'color' || this.getData().model === 'colorc') {
                          color_temp = this.util.clamp(1 - this.util.normalize(parsedJSON.params.ct, 1700, 6500), 0, 1);
                        } else if (this.getData().model === 'lamp') {
                          color_temp = this.util.clamp(1 - this.util.normalize(parsedJSON.params.ct, 2600, 5000), 0, 1);
                        } else {
                          color_temp = this.util.clamp(1 - this.util.normalize(parsedJSON.params.ct, 2700, 6500), 0, 1);
                        }
                        if (this.hasCapability('light_temperature')) {
                          if (this.getCapabilityValue('light_temperature') !== this.util.clamp(color_temp, 0, 1)) {
                            try {
                              await this.setCapabilityValue('light_temperature', this.util.clamp(color_temp, 0, 1));
                            } catch (err) {
                              this.error('Error setting "light_temperature":', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'bg_ct':
                      {
                        var color_temp = this.util.clamp(1 - this.util.normalize(parsedJSON.params.ct, 2700, 6500), 0, 1);
                        if (this.hasCapability('light_temperature.bg')) {
                          if (this.getCapabilityValue('light_temperature.bg') !== this.util.clamp(color_temp, 0, 1)) {
                            try {
                              await this.setCapabilityValue('light_temperature.bg', this.util.clamp(color_temp, 0, 1));
                            } catch (err) {
                              this.error('Error setting "light_temperature.bg":', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'rgb':
                      {
                        var color = tinycolor(parsedJSON.params.rgb.toString(16));
                        var hsv = color.toHsv();
                        var hue = Number((hsv.h / 359).toFixed(2));
                        var saturation = Number(hsv.s.toFixed(2));
                        if (this.hasCapability('light_hue') && this.hasCapability('light_saturation')) {
                          if (this.getCapabilityValue('light_hue') !== this.util.clamp(hue, 0, 1)) {
                            try {
                              await this.setCapabilityValue('light_hue', this.util.clamp(hue, 0, 1));
                            } catch (err) {
                              this.error('Error setting "light_hue":', err);
                            }
                          }
                          if (this.getCapabilityValue('light_saturation') !== saturation) {
                            try {
                              await this.setCapabilityValue('light_saturation', saturation);
                            } catch (err) {
                              this.error('Error setting "light_saturation":', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'bg_rgb':
                      {
                        var rgb_color = tinycolor(parsedJSON.params.bg_rgb.toString(16));
                        var rgb_hsv = rgb_color.toHsv();
                        var rgb_hue = Number((rgb_hsv.h / 359).toFixed(2));
                        var rgb_saturation = Number(rgb_hsv.s.toFixed(2));
                        if (this.hasCapability('light_hue') && this.hasCapability('light_saturation')) {
                          if (this.getCapabilityValue('light_hue') !== this.util.clamp(rgb_hue, 0, 1)) {
                            try {
                              await this.setCapabilityValue('light_hue', this.util.clamp(rgb_hue, 0, 1));
                            } catch (err) {
                              this.error('Error setting "light_hue" from bg_rgb:', err);
                            }
                          }
                          if (this.getCapabilityValue('light_saturation') !== rgb_saturation) {
                            try {
                              await this.setCapabilityValue('light_saturation', rgb_saturation);
                            } catch (err) {
                              this.error('Error setting "light_saturation" from bg_rgb:', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'hue':
                      {
                        var hue = parsedJSON.params.hue / 359;
                        if (this.hasCapability('light_hue')) {
                          if (this.getCapabilityValue('light_hue') !== this.util.clamp(hue, 0, 1)) {
                            try {
                              await this.setCapabilityValue('light_hue', this.util.clamp(hue, 0, 1));
                            } catch (err) {
                              this.error('Error setting "light_hue" from hue:', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'bg_hue':
                      {
                        var bg_hue = parsedJSON.params.bg_hue / 359;
                        if (this.hasCapability('light_hue')) {
                          if (this.getCapabilityValue('light_hue') !== this.util.clamp(bg_hue, 0, 1)) {
                            try {
                              await this.setCapabilityValue('light_hue', this.util.clamp(bg_hue, 0, 1));
                            } catch (err) {
                              this.error('Error setting "light_hue" from bg_hue:', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'sat':
                      {
                        var saturation = parsedJSON.params.sat / 100;
                        if (this.hasCapability('light_saturation')) {
                          if (this.getCapabilityValue('light_saturation') !== saturation) {
                            try {
                              await this.setCapabilityValue('light_saturation', saturation);
                            } catch (err) {
                              this.error('Error setting "light_saturation" from sat:', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'bg_sat':
                      {
                        var bg_saturation = parsedJSON.params.bg_sat / 100;
                        if (this.hasCapability('light_saturation')) {
                          if (this.getCapabilityValue('light_saturation') !== bg_saturation) {
                            try {
                              await this.setCapabilityValue('light_saturation', bg_saturation);
                            } catch (err) {
                              this.error('Error setting "light_saturation" from bg_sat:', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'color_mode':
                      {
                        if (this.hasCapability('light_mode')) {
                          let mode = parsedJSON.params.color_mode === 2 ? 'temperature' : 'color';
                          if (this.getCapabilityValue('light_mode') !== mode) {
                            try {
                              await this.setCapabilityValue('light_mode', mode);
                            } catch (err) {
                              this.error('Error setting "light_mode":', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'bg_lmode':
                      {
                        if (this.hasCapability('light_mode.bg')) {
                          let mode = parsedJSON.params.bg_lmode === 2 ? 'temperature' : 'color';
                          if (this.getCapabilityValue('light_mode.bg') !== mode) {
                            try {
                              await this.setCapabilityValue('light_mode.bg', mode);
                            } catch (err) {
                              this.error('Error setting "light_mode.bg":', err);
                            }
                          }
                        }
                      }
                      break;
                    case 'nl_br':
                      {
                        if (parsedJSON.params.nl_br !== 0) {
                          var dim = parsedJSON.params.nl_br / 100;
                          if (this.getCapabilityValue('dim') !== dim) {
                            try {
                              await this.setCapabilityValue('dim', dim);
                            } catch (err) {
                              this.error('Error setting "dim" from nl_br:', err);
                            }
                          }
                        }
                        if (this.hasCapability('night_mode')) {
                          if (parsedJSON.params.active_mode == 0 && this.getCapabilityValue('night_mode') === true) {
                            try {
                              await this.setCapabilityValue('night_mode', false);
                            } catch (err) {
                              this.error('Error setting "night_mode" to false:', err);
                            }
                          } else if (parsedJSON.params.active_mode !== 0 && this.getCapabilityValue('night_mode') === false) {
                            try {
                              await this.setCapabilityValue('night_mode', true);
                            } catch (err) {
                              this.error('Error setting "night_mode" to true:', err);
                            }
                          }
                        }
                      }
                      break;
                    default:
                      break;
                  }
                }
              } else if (parsedJSON.result) {
                // Handle 'result' messages
                if (parsedJSON.result[0] !== 'ok') {
                  var dim = parsedJSON.result[1] / 100;
                  var hue = parsedJSON.result[5] / 359;
                  var saturation = parsedJSON.result[6] / 100;

                  let color_temp;
                  if (this.getData().model === 'color') {
                    color_temp = this.util.normalize(parsedJSON.result[3], 1700, 6500);
                  } else if (this.getData().model === 'lamp') {
                    color_temp = this.util.normalize(parsedJSON.result[3], 2600, 5000);
                  } else {
                    color_temp = this.util.normalize(parsedJSON.result[3], 2700, 6500);
                  }

                  var color_mode = parsedJSON.result[2] == 2 ? 'temperature' : 'color';

                  if (parsedJSON.result[0] === 'on' && this.getCapabilityValue('onoff') !== true) {
                    try {
                      await this.setCapabilityValue('onoff', true);
                    } catch (err) {
                      this.error('Error setting "onoff" in result:', err);
                    }
                  } else if (parsedJSON.result[0] === 'off' && this.getCapabilityValue('onoff') !== false) {
                    try {
                      await this.setCapabilityValue('onoff', false);
                    } catch (err) {
                      this.error('Error setting "onoff" to false in result:', err);
                    }
                  }

                  if (this.getCapabilityValue('dim') !== dim) {
                    try {
                      await this.setCapabilityValue('dim', dim);
                    } catch (err) {
                      this.error('Error setting "dim" in result:', err);
                    }
                  }

                  if (this.hasCapability('light_mode')) {
                    if (this.getCapabilityValue('light_mode') !== color_mode) {
                      try {
                        await this.setCapabilityValue('light_mode', color_mode);
                      } catch (err) {
                        this.error('Error setting "light_mode" in result:', err);
                      }
                    }
                  }

                  if (this.hasCapability('light_temperature')) {
                    if (this.getCapabilityValue('light_temperature') !== this.util.clamp(color_temp, 0, 1)) {
                      try {
                        await this.setCapabilityValue('light_temperature', this.util.clamp(color_temp, 0, 1));
                      } catch (err) {
                        this.error('Error setting "light_temperature" in result:', err);
                      }
                    }
                  }

                  if (this.hasCapability('light_hue')) {
                    if (this.getCapabilityValue('light_hue') !== this.util.clamp(hue, 0, 1)) {
                      try {
                        await this.setCapabilityValue('light_hue', this.util.clamp(hue, 0, 1));
                      } catch (err) {
                        this.error('Error setting "light_hue" in result:', err);
                      }
                    }
                  }

                  if (this.hasCapability('light_saturation')) {
                    if (this.getCapabilityValue('light_saturation') !== saturation) {
                      try {
                        await this.setCapabilityValue('light_saturation', saturation);
                      } catch (err) {
                        this.error('Error setting "light_saturation" in result:', err);
                      }
                    }
                  }
                }
              }
            } catch (error) {
              this.error(error);
            }

            // Update the starting index for the next potential JSON object
            startIndex = this.buffer.indexOf('{');
          } else {
            // No complete JSON object found, exit loop
            break;
          }
        }
      } catch (err) {
        this.error(err);
      }
    });
  }

  async sendCommand(id, command) {
    if (this.connecting && !this.connected) {
      throw new Error('Cannot send command: Socket is still connecting.');
    } else if (!this.connected) {
      throw new Error('Cannot send command: Connection to device is broken.');
    } else if (!this.socket) {
      throw new Error('Cannot send command: Socket is not available.');
    } else {
      this.socket.write(command + '\r\n');
      return true;
    }
  }

  isConnected() {
    return this.connecting || this.connected;
  }

  async saveState(device) {
    try {
      let savedState = {
        onoff: await device.getCapabilityValue('onoff'),
        dim: await device.getCapabilityValue('dim')
      };
      if (device.hasCapability('light_temperature')) {
        savedState.light_temperature = await device.getCapabilityValue('light_temperature');
      }
      if (device.hasCapability('light_hue')) {
        savedState.light_hue = await device.getCapabilityValue('light_hue');
      }
      if (device.hasCapability('light_saturation')) {
        savedState.light_saturation = await device.getCapabilityValue('light_saturation');
      }
      if (device.hasCapability('night_mode')) {
        savedState.night_mode = await device.getCapabilityValue('night_mode');
      }
      if (device.hasCapability('onoff.bg')) {
        savedState.onoff_bg = await device.getCapabilityValue('onoff.bg');
      }
      if (device.hasCapability('dim.bg')) {
        savedState.dim_bg = await device.getCapabilityValue('dim.bg');
      }
      if (device.hasCapability('light_temperature.bg')) {
        savedState.light_temperature_bg = await device.getCapabilityValue('light_temperature.bg');
      }

      await device.setStoreValue('savedstate', savedState);

      return true;
    } catch (error) {
      this.error('Error in saveState:', error);
      throw error;
    }
  }

  async setState(device) {
    try {
      let savedState = await device.getStoreValue('savedstate');
      if (!savedState) {
        throw new Error('No saved state found.');
      }

      if (device.getCapabilityValue('onoff') !== savedState.onoff) {
        await device.triggerCapabilityListener('onoff', savedState.onoff).catch((err) => this.error('Error triggering "onoff" in setState:', err));
      }
      if (device.getCapabilityValue('dim') !== savedState.dim) {
        await device.triggerCapabilityListener('dim', savedState.dim).catch((err) => this.error('Error triggering "dim" in setState:', err));
      }
      if (device.hasCapability('light_temperature') && device.getCapabilityValue('light_temperature') !== savedState.light_temperature) {
        await device.triggerCapabilityListener('light_temperature', savedState.light_temperature).catch((err) => this.error('Error triggering "light_temperature" in setState:', err));
      }
      if (device.hasCapability('light_hue') && device.getCapabilityValue('light_hue') !== savedState.light_hue) {
        await device.triggerCapabilityListener('light_hue', savedState.light_hue).catch((err) => this.error('Error triggering "light_hue" in setState:', err));
      }
      if (device.hasCapability('light_saturation') && device.getCapabilityValue('light_saturation') !== savedState.light_saturation) {
        await device.triggerCapabilityListener('light_saturation', savedState.light_saturation).catch((err) => this.error('Error triggering "light_saturation" in setState:', err));
      }
      if (device.hasCapability('night_mode') && device.getCapabilityValue('night_mode') !== savedState.night_mode) {
        await device.triggerCapabilityListener('night_mode', savedState.night_mode).catch((err) => this.error('Error triggering "night_mode" in setState:', err));
      }
      if (device.hasCapability('onoff.bg') && device.getCapabilityValue('onoff.bg') !== savedState.onoff_bg) {
        await device.triggerCapabilityListener('onoff.bg', savedState.onoff_bg).catch((err) => this.error('Error triggering "onoff.bg" in setState:', err));
      }
      if (device.hasCapability('dim.bg') && device.getCapabilityValue('dim.bg') !== savedState.dim_bg) {
        await device.triggerCapabilityListener('dim.bg', savedState.dim_bg).catch((err) => this.error('Error triggering "dim.bg" in setState:', err));
      }
      if (device.hasCapability('light_temperature.bg') && device.getCapabilityValue('light_temperature.bg') !== savedState.light_temperature_bg) {
        await device.triggerCapabilityListener('light_temperature.bg', savedState.light_temperature_bg).catch((err) => this.error('Error triggering "light_temperature.bg" in setState:', err));
      }

      return true;
    } catch (error) {
      this.error('Error in setState:', error);
      throw error;
    }
  }
}

module.exports = YeelightDevice;
