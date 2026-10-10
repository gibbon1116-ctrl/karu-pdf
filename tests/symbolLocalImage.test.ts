import {expect,it} from 'vitest'
import {describeLocalBody,compareLocalBody,planLocalImageTiles,LOCAL_IMAGE_MAX_PIXELS,type SymbolImagePatch} from '../src/core/symbolLocalImage'

function patch(filled:boolean,wire=false):SymbolImagePatch {
 const gray=new Uint8Array(80*120),body:[number,number,number,number]=[20,20,60,100]
 for(let y=20;y<100;y++)for(let x=20;x<60;x++)if(filled||x<23||x>=57||y<23||y>=97||wire&&Math.abs(y-60)<=2)gray[y*80+x]=255
 return {width:80,height:120,gray,body}
}
it('rejects black versus outline in both directions while retaining a crossing wire',()=>{
 const black=describeLocalBody(patch(true)),outline=describeLocalBody(patch(false)),crossed=describeLocalBody(patch(false,true))
 expect(compareLocalBody(black,outline)).toBe('different');expect(compareLocalBody(outline,black)).toBe('different')
 expect(compareLocalBody(outline,crossed)).toBe('same')
})
it('does not claim a decision for a reduced or clipped crop',()=>{
 const a=patch(true);a.body=[1,1,8,8]
 expect(compareLocalBody(describeLocalBody(patch(false)),describeLocalBody(a))).toBe('unknown')
 a.body=[-1,0,50,80];expect(describeLocalBody(a).known).toBe(false)
})
it('keeps white holes and does not collapse an ambiguous partial fill to an outline',()=>{
 const a=patch(true);for(let y=30;y<90;y++)for(let x=30;x<50;x++)a.gray[y*80+x]=0
 const b=describeLocalBody(a),outline=describeLocalBody(patch(false))
 expect(b.density).toBeGreaterThan(0);expect(b.density).toBeLessThan(.65)
 expect(compareLocalBody(b,outline)).toBe('unknown')
})
it('batches densely packed candidates without exceeding resident pixels or losing indices',()=>{
 const rects=Array.from({length:500},(_,i)=>[i%40*30,Math.floor(i/40)*40,i%40*30+5,Math.floor(i/40)*40+20] as [number,number,number,number])
 const tiles=planLocalImageTiles(rects,8)
 expect(tiles.flatMap(t=>t.indices).sort((a,b)=>a-b)).toEqual(Array.from({length:500},(_,i)=>i))
 for(const t of tiles){expect(t.indices.length).toBeLessThanOrEqual(32);expect((t.rect[2]-t.rect[0])*(t.rect[3]-t.rect[1])).toBeLessThanOrEqual(LOCAL_IMAGE_MAX_PIXELS)}
})
