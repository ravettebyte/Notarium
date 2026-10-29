export function referenceWav(notes) {
  if(!Array.isArray(notes)||!notes.length||notes.length>12)throw Object.assign(new Error('Referência indisponível.'),{status:404});
  const pitches=notes.map(note=>{const match=/^([A-G])([#b]?)(-?\d+)?$/.exec(String(note));if(!match)throw Object.assign(new Error('Nota inválida.'),{status:400});return (Number(match[3]??4)+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1]])+(match[2]==='#'?1:match[2]==='b'?-1:0);});
  const rate=22050;const samples=rate;const buffer=Buffer.alloc(44+samples*2);
  buffer.write('RIFF');buffer.writeUInt32LE(36+samples*2,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++){const time=i/rate;const envelope=Math.min(1,time/0.02)*Math.exp(-time*4);const sound=pitches.reduce((sum,n)=>sum+Math.sin(2*Math.PI*440*2**((n-69)/12)*time),0)/pitches.length;buffer.writeInt16LE(Math.round(sound*envelope*24000),44+i*2);}
  return new Uint8Array(buffer).buffer;
}
