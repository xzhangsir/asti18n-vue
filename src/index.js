/**
 * 解析 转换 生成
 */
/**
 *             sfc
 *         @vue/compiler-sfc
 * script                     template
 *                指令 插值                     文本
 *                                    转换普通文本为i18n的方法
 *          @babel/parser
 *           解析生成ast
 *          @babel/traverse           提前文案      生成语言文件
 * 遍历ast分析js表达式里的中文字符
 *          @babel/types
 *生成vue-i18n方法调用的ast节点并转换中文字符ast节点
 *          @babel/generator
 *           生成js代码
 *           组合代码
 */
const vueParser = require('@vue/compiler-sfc')
const babelParser = require('@babel/parser')
// @babel/traverse 用来遍历和修改由 @babel/parser 解析出来的AST
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
// 将 AST 转换为代码。
const babelGenerator = require('@babel/generator').default
const fs = require('fs')
const path = require('path')

const prettier = require('prettier')
const U = require('./utils.js')

// 提取出来的英文词条
const saveCNLocaleFile = path.resolve(__dirname, './lange/locale-cn.json')
// 提取出来的中文词条
const saveENLocaleFile = path.resolve(__dirname, './lange/locale-en.json')
// 没有找到的词条
const saveNotENLocaleFile = path.resolve(__dirname, './lange/no-en-lang.json')
// 需要提取的文件路径
const handleFileDirPath = path.resolve(__dirname, '../views/app2')

traverseDir(handleFileDirPath, processFile)

function traverseDir(dirPath, callback) {
  try {
    fs.readdir(dirPath, (err, files) => {
      if (err) {
        console.error('目录读取错误:', err)
        return
      }
      files.forEach((file) => {
        const filePath = path.join(dirPath, file)
        fs.stat(filePath, (err, stats) => {
          if (err) {
            console.error('读取文件信息错误:', err)
            return
          }
          if (stats.isDirectory()) {
            traverseDir(filePath, callback) // 递归遍历子目录
          } else {
            const extname = path.extname(filePath)
            if (extname === '.vue') {
              callback(filePath) // 处理vue文件
            }
          }
        })
      })
    })
  } catch (err) {
    console.error('遍历目录错误:', err)
  }
}

async function processFile(filePath) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf-8')
    let descriptor = vueParser.parse(data).descriptor
    descriptor.template.content = generateTemplate({
      ...transformTemplate(descriptor.template.ast),
      tag: ''
    })
    if (
      descriptor.script?.content &&
      hasChineseCharacterInJS(descriptor.script.content)
    ) {
      descriptor.script.content = generateJS(
        transformJS(descriptor.script.content)
      )
    }
    let res = await generateSfc(descriptor)
    await fs.promises.writeFile(filePath, res)
  } catch (err) {
    console.error('文件处理错误:', err)
  }

  fs.readFile(saveCNLocaleFile, 'utf8', (err, data) => {
    if (err) {
      console.error('读取CN——json文件错误:', err)
      return
    }
    let allCNLocales = { ...JSON.parse(data || '{}'), ...U.allLocales }
    fs.writeFileSync(saveCNLocaleFile, JSON.stringify(allCNLocales))
  })
  fs.readFile(saveENLocaleFile, 'utf8', (err, data) => {
    if (err) {
      console.error('读取EN——json文件错误:', err)
      return
    }
    let allENLocales = { ...JSON.parse(data || '{}'), ...U.enLang }
    fs.writeFileSync(saveENLocaleFile, JSON.stringify(allENLocales))
  })
  fs.readFile(saveNotENLocaleFile, 'utf8', (err, data) => {
    if (err) {
      console.error('读取not-EN——json文件错误:', err)
      return
    }
    let allNotENLocales = { ...JSON.parse(data || '{}'), ...U.notEnLang }
    fs.writeFileSync(saveNotENLocaleFile, JSON.stringify(allNotENLocales))
  })
}

function generateTemplate(templateAst, children = '') {
  if (templateAst.children?.length) {
    children = templateAst.children.reduce((result, child) => {
      return result + generateTemplate(child)
    }, '')
  }
  // 元素节点
  if (templateAst.type === 1) {
    return generateElement(templateAst, children)
  }
  return templateAst.loc.source || children
}
function generateElement(node, children) {
  let attributes = ''

  if (node.props?.length) {
    attributes = ` ${generateElementAttr(node.props)}`
  }
  if (node.tag) {
    const selfClosingTags = ['br', 'hr', 'img', 'input', 'link', 'meta']

    if (node.isSelfClosing || selfClosingTags.includes(node.tag)) {
      return `<${node.tag}${attributes}/>\n`
    }
    return `<${node.tag}${attributes}>${children}</${node.tag}>\n`
  }
  return children
}
function generateElementAttr(attrs) {
  return attrs.map((attr) => attr.loc.source).join(' ')
}
/**
 * 组合template，script，style
 */
function generateSfc(descriptor) {
  let result = ''

  const { template, script, styles } = descriptor
  ;[template, script, ...styles].forEach((block) => {
    if (block && block.type) {
      result += `<${block.type}${Object.entries(block.attrs).reduce(
        (attrCode, [attrName, attrValue]) => {
          if (attrValue === true) {
            attrCode += ` ${attrName}`
          } else {
            attrCode += ` ${attrName}="${attrValue}"`
          }
          return attrCode
        },
        ''
      )}>${block.content}</${block.type}>`
    }
  })
  return prettier.format(result, {
    parser: 'vue',
    semi: false,
    singleQuote: true,
    trailingComma: 'none',
    htmlwhitespacesensitivity: 'ignore',
    printwidth: 300,
    tabwidth: 2,
    useTabs: true,
    arrowParens: 'avoid'
  })
}

function transformTemplate(ast) {
  if (ast.props && ast.props.length) {
    ast.props = ast.props.map((prop) => {
      // debugger
      // vue指令
      if (prop.type === 7 && U.hasChineseCharacter(prop.exp?.content)) {
        const jsCode = generateInterpolation(
          transformJS(prop.exp?.content, true)
        )
        return createDirectiveAttr(prop.name, prop.arg?.content, jsCode)
      }
      // 普通属性
      if (prop.type === 6 && U.hasChineseCharacter(prop.value?.content)) {
        const localeKey = U.extractChar(prop.value?.content)
        if (localeKey) {
          return {
            type: 6,
            loc: {
              source: `:${prop.name}="$t('${localeKey}')"`
            }
          }
        }
      }
      return prop
    })
  }
  if (ast.children?.length) {
    ast.children = ast.children.map((child) => {
      // 元素
      if (child.type === 1) {
        return transformTemplate(child)
      }
      // 文本
      if (child.type === 2 && U.hasChineseCharacter(child.content)) {
        const localeKey = U.extractChar(child.content)
        if (localeKey) {
          return createInterpolationNode(`$t('${localeKey}')`)
        }
      }
      // 插值
      if (child.type === 5 && U.hasChineseCharacter(child.content?.content)) {
        const jsCode = generateInterpolation(
          transformJS(child.content?.content, true)
        )
        return createInterpolationNode(jsCode)
      }
      return child
    })
  }
  return ast
}

function createInterpolationNode(content) {
  return {
    type: 5,
    loc: {
      source: `{{ ${content} }}`
    }
  }
}

function createDirectiveAttr(type, name, value) {
  // 事件
  if (type === 'on') {
    return {
      name: 'on',
      type: 7,
      loc: {
        source: `@${name}="${value}"`
      }
    }
  }
  if (type === 'if') {
    return {
      name: 'if',
      type: 7,
      loc: {
        source: `v-if="${value}"`
      }
    }
  }
  if (type === 'for') {
    return {
      name: 'for',
      type: 7,
      loc: {
        source: `v-for="${value}"`
      }
    }
  }
  if (type === 'bind') {
    return {
      name: 'bind',
      type: 7,
      loc: {
        source: `:${name}="${value}"`
      }
    }
  }
  return {
    name,
    type: 7,
    loc: {
      source: `v-${name}="${value}"`
    }
  }
}

function transformJS(code, isInTemplate) {
  const ast = parseJS(code)
  // let Program = []
  // let StringLiteral = []
  // let TemplateLiteral = []
  // let JSXText = []
  const visitor = {
    Program: {
      exit: (nodePath) => {
        // Program.push(nodePath)
        if (
          nodePath.node.directives?.some((node) => {
            return U.hasChineseCharacter(node.value.extra.rawValue)
          })
        ) {
          let flag = true
          let newNodes = nodePath.node.directives.map((n) => {
            let localeKey =
              n.value?.extra?.rawValue &&
              U.extractChar(n.value?.extra?.rawValue)
            flag = flag && localeKey
            if (localeKey) {
              if (isInTemplate) {
                return {
                  type: 'Directive',
                  value: {
                    type: 'DirectiveLiteral',
                    extra: {
                      raw: "$t('" + localeKey + "')",
                      rawValue: "$t('" + localeKey + "')"
                    },
                    value: "$t('" + localeKey + "')"
                  }
                }
              }
            } else {
              return n
            }
          })
          if (flag) {
            nodePath.replaceWith({
              type: 'Program',
              directives: newNodes,
              body: []
            })
          }
        }
      }
    },
    StringLiteral: {
      exit: (nodePath) => {
        // StringLiteral.push(nodePath)
        if (U.hasChineseCharacter(nodePath.node.extra?.rawValue)) {
          const localeKey = U.extractChar(nodePath.node.extra?.rawValue)
          if (localeKey) {
            if (isInTemplate) {
              nodePath.replaceWith(
                t.callExpression(t.identifier('$t'), [
                  t.stringLiteral(localeKey)
                ])
              )
            } else {
              // this.$t
              nodePath.replaceWith(
                t.callExpression(
                  t.memberExpression(t.thisExpression(), t.identifier('$t')),
                  [t.stringLiteral(localeKey)]
                )
              )
            }
          }
        }
      }
    },
    TemplateLiteral: {
      exit: (nodePath) => {
        // TemplateLiteral.push(nodePath)
        // debugger
        // 检测模板字符串内部是否含有中文字符
        if (
          nodePath.node.quasis.some((q) =>
            U.hasChineseCharacter(q.value.cooked)
          )
        ) {
          let flag = true
          let newQuasis = nodePath.node.quasis.map((q, i) => {
            let localeKey = q.value.cooked && U.extractChar(q.value.cooked)
            flag = flag && localeKey

            if (localeKey) {
              if (isInTemplate) {
                return {
                  type: 'TemplateElement',
                  value: { raw: "${$t('" + localeKey + "')}" }
                }
              } else {
                return {
                  type: 'TemplateElement',
                  value: { raw: "${this.$t('" + localeKey + "')}" }
                }
              }
            } else {
              return q
            }
          })
          if (flag) {
            nodePath.replaceWith({
              type: 'TemplateLiteral',
              quasis: newQuasis,
              expressions: nodePath.node.expressions
            })
          }
        }
      }
    },
    JSXText: {
      exit: (nodePath) => {
        // JSXText.push(nodePath)
        if (U.hasChineseCharacter(nodePath.node.value)) {
          const localeKey = U.extractChar(nodePath.node.extra?.rawValue)
          if (localeKey) {
            nodePath.replaceWith(
              t.jsxExpressionContainer(
                t.callExpression(t.identifier('$t'), [
                  t.stringLiteral(localeKey)
                ])
              )
            )
          }
        }
      }
    }
  }
  // debugger
  traverse(ast, visitor)
  // debugger
  return ast
}

function generateInterpolation(ast) {
  return babelGenerator(ast, {
    compact: false,
    jsescOption: {
      quotes: 'single'
    }
  }).code.replace(/;/gm, '')
}

function parseJS(code) {
  return babelParser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  })
}

function hasChineseCharacterInJS(code) {
  let result = false
  traverse(parseJS(code), {
    enter: (nodePath) => {
      if (
        nodePath.node.type === 'StringLiteral' &&
        U.hasChineseCharacter(nodePath.node.extra?.rawValue)
      ) {
        nodePath.stop()
        result = true
      }

      if (
        nodePath.node.type === 'TemplateLiteral' &&
        nodePath.node.quasis.some((q) => U.hasChineseCharacter(q.value.cooked))
      ) {
        nodePath.stop()
        result = true
      }

      if (
        nodePath.node.type === 'JSXText' &&
        U.hasChineseCharacter(nodePath.node.value)
      ) {
        nodePath.stop()
        result = true
      }
    }
  })

  return result
}

/**
 * 生成script内部的JS
 */
function generateJS(ast) {
  return babelGenerator(ast).code
}

// exports.moduleName = moduleName
