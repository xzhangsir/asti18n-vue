// const A = require('./index.js')
const { createHash } = require('crypto')
// 词条库
const allLange = require('./allLange.json')
let notEnLang = {}
let allLocales = {}
let enLang = {}
function hasChineseCharacter(char) {
  return /[\u{4E00}-\u{9FEF}]/gu.test(char)
}
function extractChar(char) {
  const locale = char.trim()
  const key = generateHash(locale)
  return key && `${key}`
}

function generateHash(char) {
  for (let i = allLange.length - 1; i >= 0; i--) {
    if (allLange[i].key === char) {
      let key = allLange[i].value
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z_]/g, '')

      if (key.length > 65) {
        key = key.split('_').reduce((pre, cur) => {
          pre += cur.slice(0, 1) + '_'
          return pre
        }, '')
        key = key.slice(0, -1)
      }
      allLocales[key] = char
      enLang[key] = allLange[i].value
      return key
    } else if (
      [
        ',',
        ':',
        ';',
        '?',
        '!',
        '.',
        '，',
        '：',
        '；',
        '？',
        '！',
        '。'
      ].includes(char.slice(-1))
    ) {
      let newChar = char.substring(0, char.length - 1)
      if (allLange[i].key === newChar) {
        let key =
          allLange[i].value
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z_]/g, '') + '_'

        if (key.length > 65) {
          key = key.split('_').reduce((pre, cur) => {
            pre += cur.slice(0, 1) + '_'
            return pre
          }, '')
          key = key.slice(0, -1)
        }
        allLocales[key] = newChar + char.slice(-1)
        enLang[key] = allLange[i].value
        return key
      }
    }
  }
  const hash = createHash('md5')
  hash.update(char)
  notEnLang[hash.digest('hex')] = char
}

module.exports = {
  hasChineseCharacter,
  extractChar,
  generateHash,
  allLocales,
  notEnLang,
  enLang
}
