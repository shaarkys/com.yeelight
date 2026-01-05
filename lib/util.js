'use strict';

const dgram = require('dgram');
const advertisements = dgram.createSocket('udp4');
var new_devices = {};
var added_devices = {};
var discovery_stats = null;
var discovery_in_progress = false;
var discovery_waiters = [];
var discovery_timeout = null;
var discovery_interval = null;
var logged_ssdp_headers = { discover: {}, notification: {} };
var logged_parsed_devices = { discover: {}, notification: {} };
var last_discovery_result = null;
var last_discovery_time = 0;

class Util {
  constructor(opts) {
    this.homey = opts.homey;
  }

  /* get all previously paired yeelights for matching broadcast messages */
  async fillAddedDevices() {
    try {
      added_devices = {};
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
      const discoveryDurationMs = 7000;
      const broadcastIntervalMs = 2000;
      const discoveryCacheTtlMs = 15000;
      return new Promise((resolve) => {
        if (
          !discovery_in_progress &&
          last_discovery_result &&
          Object.keys(last_discovery_result).length > 0 &&
          Date.now() - last_discovery_time < discoveryCacheTtlMs
        ) {
          this.homey.app.log('[Util] Using cached discovery results.');
          resolve({ ...last_discovery_result });
          return;
        }

        if (discovery_in_progress) {
          this.homey.app.log('[Util] Discovery already in progress, joining existing scan.');
          discovery_waiters.push(resolve);
          return;
        }

        discovery_in_progress = true;
        discovery_waiters = [resolve];
        this.homey.app.log('[Util] Starting discovery process...');
        new_devices = {}; // Reset new_devices
        discovery_stats = {
          seen: 0,
          added: 0,
          alreadyAdded: 0,
          duplicate: 0,
          seenCounts: {},
          uniqueSeen: {},
          uniqueAdded: {},
          uniqueAlreadyAdded: {},
          uniqueDuplicate: {},
          loggedAlreadyAdded: {},
          loggedDuplicate: {}
        };
        logged_ssdp_headers.discover = {};
        logged_parsed_devices.discover = {};

        var message = [
          'M-SEARCH * HTTP/1.1',
          'HOST: 239.255.255.250:1982',
          'MAN: "ssdp:discover"',
          'ST: wifi_bulb',
          'MX: 3',
          '',
          ''
        ].join('\r\n');
        var broadcast = () =>
          advertisements.send(message, 0, message.length, 1982, '239.255.255.250', (err) => {
            if (err) {
              this.homey.app.error('[Util] Error broadcasting discovery message:', err);
            } else {
              this.homey.app.log('[Util] Discovery message sent.');
            }
          });
        broadcast();
        discovery_interval = setInterval(broadcast, broadcastIntervalMs);

        discovery_timeout = setTimeout(() => {
          if (discovery_interval) {
            clearInterval(discovery_interval);
            discovery_interval = null;
          }
          discovery_timeout = null;
          this.homey.app.log('[Util] Discovery period ended.');
          this.homey.app.log('[Util] Devices discovered:', Object.keys(new_devices));
          last_discovery_result = { ...new_devices };
          last_discovery_time = Date.now();
          if (discovery_stats) {
            const uniqueSeenIds = Object.keys(discovery_stats.uniqueSeen).sort();
            const uniqueAddedIds = Object.keys(discovery_stats.uniqueAdded).sort();
            const uniqueAlreadyAddedIds = Object.keys(discovery_stats.uniqueAlreadyAdded).sort();
            const uniqueDuplicateIds = Object.keys(discovery_stats.uniqueDuplicate).sort();
            this.homey.app.log(
              `[Util] Discovery stats: seen=${discovery_stats.seen}, added=${discovery_stats.added}, already_added=${discovery_stats.alreadyAdded}, duplicate=${discovery_stats.duplicate}`
            );
            this.homey.app.log(
              `[Util] Discovery unique stats: seen=${uniqueSeenIds.length}, added=${uniqueAddedIds.length}, already_added=${uniqueAlreadyAddedIds.length}, duplicate=${uniqueDuplicateIds.length}`
            );
            if (uniqueAddedIds.length > 0) {
              this.homey.app.log(`[Util] Discovery unique IDs (new): ${uniqueAddedIds.join(', ')}`);
            }
            if (uniqueAlreadyAddedIds.length > 0) {
              this.homey.app.log(`[Util] Discovery unique IDs (already paired): ${uniqueAlreadyAddedIds.join(', ')}`);
            }
          }
          discovery_in_progress = false;
          const waiters = discovery_waiters;
          discovery_waiters = [];
          waiters.forEach((waiter) => waiter(new_devices));
        }, discoveryDurationMs);
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
                const parsedTypeKey = result.message_type === 'notification' ? 'notification' : 'discover';
                if (!logged_parsed_devices[parsedTypeKey][result.device.id]) {
                  logged_parsed_devices[parsedTypeKey][result.device.id] = true;
                  this.homey.app.log(`[Util] Parsed device: ${result.device.id}, Type: ${result.message_type}`);
                }
                if (result.message_type === 'discover') {
                  if (discovery_stats) {
                    discovery_stats.seen += 1;
                    discovery_stats.uniqueSeen[result.device.id] = true;
                    if (!discovery_stats.seenCounts[result.device.id]) {
                      discovery_stats.seenCounts[result.device.id] = 0;
                    }
                    discovery_stats.seenCounts[result.device.id] += 1;
                    if (discovery_stats.seenCounts[result.device.id] > 1) {
                      discovery_stats.uniqueDuplicate[result.device.id] = true;
                      discovery_stats.duplicate += 1;
                    }
                  }
                }

                if (result.message_type === 'discover' && !new_devices.hasOwnProperty(result.device.id) && !added_devices.hasOwnProperty(result.device.id)) {
                  if (discovery_stats) {
                    discovery_stats.added += 1;
                    discovery_stats.uniqueAdded[result.device.id] = true;
                  }
                  new_devices[result.device.id] = result.device;
                  this.homey.app.log(`[Util] New device added: ${result.device.id}`);
                } else if (result.message_type === 'discover') {
                  if (added_devices.hasOwnProperty(result.device.id)) {
                    if (discovery_stats) {
                      discovery_stats.alreadyAdded += 1;
                      discovery_stats.uniqueAlreadyAdded[result.device.id] = true;
                      if (!discovery_stats.loggedAlreadyAdded[result.device.id]) {
                        discovery_stats.loggedAlreadyAdded[result.device.id] = true;
                        this.homey.app.log(`[Util] Device already paired, skipping: ${result.device.id}`);
                      }
                    }
                  } else if (new_devices.hasOwnProperty(result.device.id)) {
                    if (discovery_stats) {
                      if (!discovery_stats.loggedDuplicate[result.device.id]) {
                        discovery_stats.loggedDuplicate[result.device.id] = true;
                        this.homey.app.log(`[Util] Device already discovered in this scan, skipping: ${result.device.id}`);
                      }
                    }
                  }
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

        var message_type = headers.includes('NOTIFY') ? 'notification' : 'discover';

        if (headers.startsWith('M-SEARCH') || headers.includes('ssdp:discover')) {
          this.homey.app.log('[Util] No devices found in the message.');
          return resolve('no devices');
        }

        var headerMap = {};
        headers.split('\r\n').forEach((line) => {
          if (!line) return;
          var splitIndex = line.indexOf(':');
          if (splitIndex === -1) return;
          var key = line.substring(0, splitIndex).trim().toLowerCase();
          var value = line.substring(splitIndex + 1).trim();
          if (key) headerMap[key] = value;
        });

        const props = {
          power: headerMap.power,
          bright: headerMap.bright,
          color_mode: headerMap.color_mode,
          ct: headerMap.ct,
          rgb: headerMap.rgb,
          hue: headerMap.hue,
          sat: headerMap.sat
        };
        if (headerMap.location || headerMap.id || headerMap.model) {
          const typeKey = message_type === 'notification' ? 'notification' : 'discover';
          const logKey = headerMap.id || headerMap.location || headerMap.model || 'unknown';
          if (!logged_ssdp_headers[typeKey][logKey]) {
            logged_ssdp_headers[typeKey][logKey] = true;
            this.homey.app.log(
              `[Util] SSDP headers: location=${headerMap.location || '-'}, id=${headerMap.id || '-'}, model=${headerMap.model || '-'}, props=${JSON.stringify(props)}`
            );
          }
        }

        if (!headerMap.location) {
          this.homey.app.log('[Util] No location header found in the message.');
          return resolve('no devices');
        }

        var locationValue = headerMap.location.replace(/^yeelight:\/\//i, '');
        var address = '';
        var port = 0;
        if (locationValue.startsWith('[')) {
          var closingIndex = locationValue.indexOf(']');
          address = locationValue.substring(1, closingIndex);
          port = parseInt(locationValue.substring(closingIndex + 2), 10);
        } else {
          var locationParts = locationValue.split(':');
          address = locationParts[0];
          port = parseInt(locationParts[1], 10);
        }

        var device = {
          id: headerMap.id,
          address: address,
          port: port,
          model: headerMap.model,
          onoff: headerMap.power === 'on',
          dim: parseInt(headerMap.bright, 10),
          mode: parseInt(headerMap.color_mode, 10),
          temperature: parseInt(headerMap.ct, 10),
          rgb: parseInt(headerMap.rgb, 10),
          hue: parseInt(headerMap.hue, 10),
          saturation: parseInt(headerMap.sat, 10)
        };

        //this.homey.app.log('[Util] Device parsed:', device);
        return resolve({ message_type, device });
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
