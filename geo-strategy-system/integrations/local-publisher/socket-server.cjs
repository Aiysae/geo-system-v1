const http=require('node:http'),net=require('node:net'),fs=require('node:fs'),path=require('node:path');

async function listen(socketPath,command){
  fs.mkdirSync(path.dirname(socketPath),{recursive:true,mode:0o700});
  // Only remove an abandoned socket; never disconnect a live executor.
  if(fs.existsSync(socketPath)){
    const error=await new Promise(resolve=>{const socket=net.connect(socketPath);socket.setTimeout(2000);socket.once('connect',()=>{socket.destroy();resolve(null);});socket.once('error',resolve);socket.once('timeout',()=>{socket.destroy();resolve(null);});});
    if(!error||error.code!=='ECONNREFUSED')throw Error('Publisher socket is already in use');
    if(!fs.lstatSync(socketPath).isSocket())throw Error('Publisher socket path is not a socket');
    fs.unlinkSync(socketPath);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.method==='GET'&&req.url==='/health'){res.end('{"ok":true}');return;}
    if(req.method!=='POST'||req.url!=='/command'){res.writeHead(404);res.end('{}');return;}
    try{
      const parts=[];let size=0;
      for await(const part of req){size+=part.length;if(size>2*1024*1024){res.writeHead(413);res.end('{}');return;}parts.push(part);}
      const m=JSON.parse(Buffer.concat(parts));
      const data=await command(m.owner,m.action,m.input||{});res.end(JSON.stringify({ok:true,data}));
    }catch(error){res.end(JSON.stringify({ok:false,error:String(error.message||'操作失败').slice(0,250)}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{fs.chmodSync(socketPath,0o600);resolve();});});
  return server;
}
module.exports={listen};
