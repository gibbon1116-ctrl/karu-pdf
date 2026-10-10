import {expect,it} from 'vitest'
import {compareLocalLabel,describeLocalLabel,glyphSimilarity,glyphStrokeRatio,resolveLocalLabels,type LocalLabel} from '../src/core/symbolGlyphs'
import {UNKNOWN_SYMBOL_LABEL,symbolLabelDisplay,normalizeSymbolLabel} from '../src/core/symbolLabels'

const mask=new Uint8Array(20*28);for(let y=1;y<27;y++)mask[y*20+2]=1
const glyph={text:'B',score:.97,gap:.1,rect:[1,1,5,10] as [number,number,number,number],distance:1,mask}
const read=(text:string):LocalLabel=>({text,status:'read',glyphs:[{...glyph,text}]})
it('does not rename a confidently different character using shape equality',()=>{
 expect(compareLocalLabel(read('B'),read('8'))).toBe('different')
 expect(compareLocalLabel(read('B'),read('C'))).toBe('different')
 expect(compareLocalLabel(read('B'),read('B'))).toBe('same')
})
it('supplements an ambiguous name from a readable equal glyph, and keeps unread/no-label separate',()=>{
 expect(compareLocalLabel(read('B'),{text:'',status:'unknown',glyphs:[glyph]})).toBe('same')
 expect(compareLocalLabel(read('B'),{text:'',status:'unknown',glyphs:[]})).toBe('unknown')
 expect(compareLocalLabel(read('B'),{text:'',status:'none',glyphs:[]})).toBe('different')
 expect(symbolLabelDisplay(UNKNOWN_SYMBOL_LABEL)).toBe('添字を判定できない')
 expect(symbolLabelDisplay('')).toBe('添字なし');expect(normalizeSymbolLabel(UNKNOWN_SYMBOL_LABEL)).toBe(null)
})
it('never calls a unavailable engine or inadequate crop text-free',()=>{
 expect(describeLocalLabel({width:50,height:50,gray:new Uint8Array(2500),body:[10,10,40,40]}).status).toBe('unknown')
 expect(glyphSimilarity(mask,new Uint8Array(20*28))).toBe(0)
 expect(glyphSimilarity(mask,new Uint8Array(1))).toBe(0)
})
it('uses readable search-scoped exemplars only, preserves confident differences and abstains on competing names',()=>{
 const unknown:LocalLabel={text:'',status:'unknown',glyphs:[{...glyph,text:'8',gap:.01}]}
 expect(resolveLocalLabels([read('B'),unknown])[1]).toMatchObject({text:'B',status:'read'})
 expect(resolveLocalLabels([read('B'),read('8')])[1].text).toBe('8')
 expect(resolveLocalLabels([read('B'),read('8'),unknown])[2].status).toBe('unknown')
})
it('distinguishes thin lettering from broad wire fragments without inventing a name',()=>{
 const thin=new Uint8Array(20*28),broad=new Uint8Array(20*28)
 for(let y=0;y<28;y++){thin[y*20+5]=1;for(let x=5;x<13;x++)broad[y*20+x]=1}
 expect(glyphStrokeRatio(thin)).toBeLessThan(.04)
 expect(glyphStrokeRatio(broad)).toBeGreaterThan(.12)
 expect(glyphStrokeRatio(new Uint8Array(1))).toBe(Infinity)
})
