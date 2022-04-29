'use strict';

const Homey = require('homey');
const uuid = require('uuid')
const crypto = require('crypto');
const fxparser = require("fast-xml-parser");
const nodeFetch = require('node-fetch');


class ISmartGateApp extends Homey.App {
  async onInit() {
    let ISMARTGATE_UDI = null;
    let ISMARTGATE_USERNAME = null;
    let ISMARTGATE_PASSWORD = null;

    let that = this;
    function getSettings() {
      ISMARTGATE_UDI = that.homey.settings.get('udi');
      if (!ISMARTGATE_UDI) {
        throw new Error("You are not logged in to your ismartgate device. Go to settings and fill in UDI and other fields.");
      }
      ISMARTGATE_USERNAME = that.homey.settings.get('username');
      if (!ISMARTGATE_USERNAME) {
        throw new Error("You are not logged in to your ismartgate device. Go to settings and fill in username and other fields.");
      }
      ISMARTGATE_PASSWORD = that.homey.settings.get('password');
      if (!ISMARTGATE_USERNAME) {
        throw new Error("You are not logged in to your ismartgate device. Go to settings and fill in password and other fields.");
      }
    }

    const doorIsOpen = this.homey.flow.getConditionCard('door-is-open');
    doorIsOpen.registerRunListener(async (args) => {
      const {doorNumber} = args;

      getSettings();

      const aesBlockSize = 16;

      const rawToken = `${ISMARTGATE_USERNAME.toLowerCase()}@ismartgate`

      let sha1 = function(input) {
        return crypto.createHash('sha1').update(input).digest('hex')
      }
      const hashedToken = sha1(rawToken);

      const sha1HexStr = sha1(ISMARTGATE_USERNAME.toLowerCase() + ISMARTGATE_PASSWORD)

      const apiCipherKey = `${sha1HexStr.slice(32, 36)}a${sha1HexStr.slice(7, 10)}!${sha1HexStr.slice(18, 21)}*#${sha1HexStr.slice(24, 26)}`

      const commandStr = `["${ISMARTGATE_USERNAME}", "${ISMARTGATE_PASSWORD}", "info", "", ""]`

      const buffer = Buffer.alloc(16);
      uuid.v4({}, buffer);
      let initVector = buffer.toString('hex');

      const initVectorBytes = initVector.slice(0, aesBlockSize);

      let encryptAES256CBC = ((val) => {
        let cipher = crypto.createCipheriv('aes-128-cbc', apiCipherKey, initVectorBytes);
        let encrypted = cipher.update(val, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
      });

      const encryptedCommandStr = initVectorBytes + encryptAES256CBC(commandStr);

      const t = (1 + 99999999 * (Math.random() | 0)).toString();

      const params = {
        data: encryptedCommandStr,
        t: t,
        token: hashedToken
      };
      const apiUrl = `https://${ISMARTGATE_UDI}.isgaccess.com/api.php?` + new URLSearchParams(params);

      function decrypt(text) {
        let initialVector = text.slice(0, aesBlockSize);
        let encryptedBytes = text.slice(aesBlockSize);
        let decipher = crypto.createDecipheriv('aes-128-cbc', apiCipherKey, initialVector);
        let decrypted = decipher.update(encryptedBytes, 'base64', 'utf8');
        return (decrypted + decipher.final('utf8'));
      }

      function isDoorOpen(xmlStr, doorNumber = 1) {
        let parser = new fxparser.XMLParser();
        let obj = parser.parse(xmlStr);
        return obj.response[`door${doorNumber}`].status === 'opened';
      }

      return await nodeFetch(apiUrl)
        .then((response) => {
          return response.text()
        }).then((text) => {
          if (text.includes('Error: invalid login or password')) {
            throw new Error('Invalid ismartgate username or password. Go to ismartgate settings and make sure your credentials are correct.')
          } else {
            const decryptedXml = decrypt(text);
            return isDoorOpen(decryptedXml, doorNumber)
          }
        }).catch(function() {
          throw new Error('Failed to reach your ismartgate device. The connection may be broken, or the UDI in the ismartgate settings page may be incorrect.')
        });
    })
  }

}

module.exports = ISmartGateApp;
