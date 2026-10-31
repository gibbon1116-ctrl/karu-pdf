import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { businessCases } from './businessCases'
const html = fs.readdirSync('dist-single').find(name => name.endsWith('.html'))!
businessCases(pathToFileURL(path.resolve('dist-single', html)).href + '?test=1')
