'use strict';

const dgram = require('dgram');
const advertisements = dgram.createSocket('udp4');
var new_devices = {};
var added_devices = {};

class Util {
  constructor(opts) {
    this.homey = opts.homey;
  }

  /* get all previously paired yeelights for matching broadcast messages */
  async fillAddedDevices() {
    try {
      let devices = await this.homey.drivers.getDriver('yeelight').getDevices();
      Object.keys(devices).forEach((key) => {
        added_devices[devices[key].getData().id] = devices[key];
      });
      return Promise.resolve(added_devices);
    } catch (error) {
      this.homey.app.error('[Util] Error in fillAddedDevices:', error);
      return Promise.reject(error);
    }
  }

  /* send discovery message during pair wizard */
  discover() {
    try {
      this.homey.app.log('[Util] Starting discovery process...');
      new_devices = {}; // Reset new_devices
      return new Promise((resolve) => {
        var message = 'M-SEARCH * HTTP/1.1\r\nMAN: "ssdp:discover"\r\nST: wifi_bulb\r\n';
        var broadcast = () =>
          advertisements.send(message, 0, message.length, 1982, '239.255.255.250', (err) => {
            if (err) {
              this.homey.app.error('[Util] Error broadcasting discovery message:', err);
            } else {
              this.homey.app.log('[Util] Discovery message sent.');
            }
          });
        broadcast();
        var broadcastInterval = setInterval(broadcast, 5000);

        setTimeout(() => {
          clearInterval(broadcastInterval);
          this.homey.app.log('[Util] Discovery period ended.');
          this.homey.app.log('[Util] Devices discovered:', Object.keys(new_devices));
          resolve(new_devices);
        }, 6000);
      });
    } catch (error) {
      this.homey.app.error('[Util] Error in discover:', error);
    }
  }

  /* listen for advertisements sent during pairing or regular intervals */
  async listenUpdates() {
    try {
      this.homey.app.log('[Util] Starting to listen for advertisements...');
      let localAddress = await this.homey.cloud.getLocalAddress();
      this.homey.app.log(`[Util] Local address resolved: ${localAddress}`);
      const interfaceAddress = this.extractInterfaceAddress(localAddress);

      advertisements.bind(1982, () => {
        if (advertisements) {
          try {
            advertisements.addMembership('239.255.255.250');
            advertisements.setBroadcast(true);
            advertisements.setMulticastTTL(255);
            if (interfaceAddress) {
              advertisements.setMulticastInterface(interfaceAddress);
              this.homey.app.log(
                `[Util] UDP socket bound and configured for multicast on ${interfaceAddress}.`
              );
            } else {
              this.homey.app.log('[Util] UDP socket bound for multicast using default interface.');
            }
          } catch (error) {
            this.homey.app.error('[Util] Failed to configure UDP multicast:', error);
          }
        }
      });

      advertisements.on('message', (message, address) => {
        this.homey.app.log(`[Util] Message received from ${address.address}:${address.port}`);
        process.nextTick(() => {
          this.parseMessage(message)
            .then((result) => {
              if (result !== 'no devices') {
                this.homey.app.log(`[Util] Parsed device: ${result.device.id}, Type: ${result.message_type}`);
                if (result.message_type === 'discover' && !new_devices.hasOwnProperty(result.device.id) && !added_devices.hasOwnProperty(result.device.id)) {
                  new_devices[result.device.id] = result.device;
                  this.homey.app.log(`[Util] New device added: ${result.device.id}`);
                } else if (result.message_type === 'discover') {
                  // this.homey.app.log(`[Util] Device already processed: ${result.device.id}`);
                }

                // In the 'listenUpdates()' function, inside advertisements.on('message'):
                Object.keys(added_devices).forEach((key) => {
                  const addedDevice = added_devices[key];
                  if (result.message_type !== 'discover' && addedDevice.getData().id === result.device.id) {

                    // Update settings if necessary
                    if (
                      addedDevice.getSetting('address') !== result.device.address ||
                      addedDevice.getSetting('port') !== result.device.port
                    ) {
                      addedDevice.setSettings({ address: result.device.address, port: result.device.port })
                        .then(() => {
                          this.homey.app.log(
                            `[Util] Updated device address: ${result.device.id} to ${result.device.address}:${result.device.port}`
                          );
                        })
                        .catch(error => {
                          // Catch and handle the rejection, so it doesn’t become an unhandled error
                          if (error.message && error.message.includes('device_not_found')) {
                            this.homey.app.log(`[Util] Could not update settings - device not found: ${result.device.id}`);
                          } else {
                            this.homey.app.error(`[Util] Failed to update device settings for ${result.device.id}:`, error);
                          }
                        });
                    }

                    // Reconnect if necessary
                    try {
                      if (!addedDevice.isConnected(result.device.id)) {
                        addedDevice.createDeviceSocket();
                        this.homey.app.log(`[Util] Reconnected to device: ${result.device.id}`);
                      }
                    } catch (error) {
                      this.homey.app.error(`[Util] Failed to reconnect device ${result.device.id}:`, error);
                    }
                  }
                });

              }
            })
            .catch((error) => {
              this.homey.app.error('[Util] Error parsing message:', error);
            });
        });
      });

      advertisements.on('error', (error) => {
        this.homey.app.error('[Util] Advertisement error:', error);
      });
    } catch (error) {
      this.homey.app.error('[Util] Error in listenUpdates:', error);
    }
  }

  /* parse incoming broadcast messages */
  parseMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        var headers = message.toString();
        var re = /: /gi;
        var re2 = /\r\n/gi;

        var message_type = headers.includes('NOTIFY') ? 'notification' : 'discover';

        if (!headers.includes('ssdp:discover')) {
          headers = headers.split('\r\nLocation:').pop();
          headers = headers.substring(0, headers.indexOf('\r\nname:'));
          headers = 'Location:' + headers;
          headers = headers.replace(re, '": "');
          headers = headers.replace(re2, '",\r\n"');
          headers = '{ "' + headers + '" }';

          var result = JSON.parse(headers);

          var location = result.Location.split(':');
          var address = location[1].replace('//', '');
          var port = parseInt(location[2], 10);

          var device = {
            id: result.id,
            address: address,
            port: port,
            model: result.model,
            onoff: result.power === 'on',
            dim: parseInt(result.bright),
            mode: parseInt(result.color_mode),
            temperature: parseInt(result.ct),
            rgb: parseInt(result.rgb),
            hue: parseInt(result.hue),
            saturation: parseInt(result.sat)
          };

          //this.homey.app.log('[Util] Device parsed:', device);
          return resolve({ message_type, device });
        } else {
          this.homey.app.log('[Util] No devices found in the message.');
          return resolve('no devices');
        }
      } catch (error) {
        this.homey.app.error('[Util] Error in parseMessage:', error);
        return reject(error);
      }
    });
  }

  normalize(value, min, max) {
    var normalized = (value - min) / (max - min);
    return Number(normalized.toFixed(2));
  }

  denormalize(normalized, min, max) {
    var denormalized = (1 - normalized) * (max - min) + min;
    return Number(denormalized.toFixed(0));
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  extractInterfaceAddress(address) {
    if (!address || typeof address !== 'string') return null;
    const match = address.match(/^\[?([^\]]+?)\]?:\d+$/); // strip port, keep IPv4 or IPv6 host
    if (match && match[1]) {
      return match[1];
    }
    return address;
  }
}

module.exports = Util;
