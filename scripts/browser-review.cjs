/* Built-app browser regression. Uses only in-memory API fixtures; never calls a real backend. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const {spawn} = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const artifacts = path.join(root, "traffic_dss_backend", ".test-tmp", "browser-artifacts");
fs.mkdirSync(artifacts, {recursive:true});
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url,"http://local").pathname);
  let file = path.resolve(dist,"." + pathname);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file=path.join(dist,"index.html");
  const types={".js":"application/javascript",".css":"text/css",".html":"text/html",".png":"image/png"};
  res.setHeader("Content-Type",types[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  console.log("Static test server ready");
  const origin="http://127.0.0.1:"+server.address().port;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"traffic-review-browser-"));
  const executable=process.env.BROWSER_EXE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser=spawn(executable,["--headless=new","--no-first-run","--no-default-browser-check","--remote-debugging-port=0",
    "--remote-allow-origins=*","--user-data-dir="+profile,"--window-size=1440,1000","--use-angle=swiftshader",
    "--enable-unsafe-swiftshader","about:blank"],{windowsHide:true,stdio:"ignore"});
  let ws;
  try {
    const portFile=path.join(profile,"DevToolsActivePort");
    for(let i=0;i<100 && !fs.existsSync(portFile);i++) await delay(100);
    assert(fs.existsSync(portFile),"Browser debugging port did not start");
    const port=fs.readFileSync(portFile,"utf8").split("\n")[0];
    const targets=await (await fetch("http://127.0.0.1:"+port+"/json")).json();
    console.log("Browser target ready");
    ws=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let sequence=0; const pending=new Map(); const errors=[];
    function call(method,params={}) {
      return new Promise((resolve,reject)=>{
        const id=++sequence; const timeout=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout: "+method));},15000); pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}}); ws.send(JSON.stringify({id,method,params}));
      });
    }
    const empty={count:0,next:null,previous:null,results:[]};
    const kpis={coverage_efficiency:0,avg_response_time:null,resource_utilization:0,weather_impact_factor:null,
      shortages:2,required_staffing:2,assigned_staffing:0,as_of:new Date().toISOString()};
    const node={id:"B-TEST",name:'Test junction <img src=x onerror="window.exploited=true">',status:"normal",
      latitude:10.72,longitude:122.56,tsi:0.1,road_priority_weight:1,deployed_officers:0,required_officers:2};
    let publications=0;
    ws.onmessage=async message=>{
      const event=JSON.parse(message.data);
      if(event.id) {const job=pending.get(event.id);if(job){pending.delete(event.id);event.error?job.reject(event.error):job.resolve(event.result);}return;}
      if(event.method==="Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text + ": " + (event.params.exceptionDetails.exception?.description || ""));
      if(event.method!=="Fetch.requestPaused") return;
      const {requestId,request}=event.params;
      const url=new URL(request.url);
      if(request.url.startsWith(origin)) {await call("Fetch.continueRequest",{requestId});return;}
      if(request.method==="OPTIONS") {await call("Fetch.fulfillRequest",{requestId,responseCode:204,responseHeaders:[{name:"Access-Control-Allow-Origin",value:"*"},{name:"Access-Control-Allow-Headers",value:"*"},{name:"Access-Control-Allow-Methods",value:"GET,POST,PUT,DELETE,OPTIONS"}]});return;}
      let payload=empty;
      if(url.pathname.includes("/kpis/")) payload=kpis;
      else if(url.pathname.includes("/bottlenecks/")) payload={...empty,count:1,results:[node]};
      else if(url.pathname.includes("/weather/")) payload={condition:null,weather_impact_factor:null,source:"missing",available:false,data_status:"unavailable",is_stale:false};
      else if(url.pathname.includes("/history/")) payload={...empty,count:1,results:[{id:1,run_id:"morning-fixture",timestamp:new Date().toISOString(),status:"completed",parameters:{shift:"morning"},fitness_scores:[],result_data:{}}]};
      else if(url.pathname.includes("/preview-optimization/")) {
        const day=JSON.parse(request.postData).operational_date;
        payload={run_id:"morning-fixture",shift:"morning",created:2,replaced:1,skipped:[],staff_added:[2,3],staff_removed:[1],conflicts:[],operational_date:day,start_time:day+"T06:00:00+08:00",end_time:day+"T14:00:00+08:00"};
      }
      else if(url.pathname.includes("/publish-optimization/")) {publications++;payload={created:2,shift:"morning",skipped:[]};}
      else if(url.pathname.includes("/pois/") && request.method==="GET") payload={...empty,count:5,results:[
        ["hospital",10.720,122.560],["fire_station",10.716,122.567],["police_station",10.724,122.565],
        ["school",10.717,122.552],["other",10.726,122.556],
      ].map(([category,latitude,longitude],index)=>({id:index+1,poi_id:"POI-"+index,name:category+" fixture",
        category,latitude,longitude,priority_boost:1,is_active:true}))};
      else if(url.pathname.includes("/pois/") && request.method==="POST") {
        await call("Fetch.fulfillRequest",{requestId,responseCode:503,responseHeaders:[{name:"Content-Type",value:"application/json"},{name:"Access-Control-Allow-Origin",value:"*"}],body:Buffer.from(JSON.stringify({detail:"Test save failure"})).toString("base64")});return;
      }
      else if(url.pathname.includes("/configure/")) payload={valid:true,parameters:JSON.parse(request.postData),errors:{}};
      else if(!url.pathname.includes("/api/")) {await call("Fetch.failRequest",{requestId,errorReason:"BlockedByClient"});return;}
      const headers=[{name:"Content-Type",value:"application/json"},{name:"Access-Control-Allow-Origin",value:"*"},{name:"Access-Control-Allow-Headers",value:"*"}];
      await call("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:headers,body:Buffer.from(JSON.stringify(payload)).toString("base64")});
    };
    await call("Page.enable");await call("Runtime.enable");await call("Network.enable");
    await call("Network.setBlockedURLs",{urls:["ws://*","wss://*"]});
    await call("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
    await call("Emulation.setTimezoneOverride",{timezoneId:"America/Los_Angeles"});
    await call("Page.addScriptToEvaluateOnNewDocument",{source:'window.WebSocket = class { constructor(){setTimeout(()=>this.onclose?.(),10);} close(){} };'});
    const auth=role=>`localStorage.setItem("auth_token","test-only");localStorage.setItem("refresh_token","test-refresh");localStorage.setItem("auth_user",JSON.stringify({id:1,username:"Browser fixture",role:"${role}",permissions:[],shift:"morning"}));`;
    const authScript=await call("Page.addScriptToEvaluateOnNewDocument",{source:auth("supervisor")});
    const evaluate=async expression=>(await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
    const waitFor=async expression=>{
      for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}
      throw Error("Timed out: "+expression+"\n"+await evaluate("document.body.innerText"));
    };
    const clickText=text=>evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})?.click()`);
    console.log("Opening dashboard");
    await call("Page.navigate",{url:origin+"/"});
    await waitFor("document.body.innerText.includes('Unfilled posts: 2')");
    await waitFor('document.querySelector(\'button[aria-label^="Test junction"]\')');
    await evaluate('document.querySelector(\'button[aria-label^="Test junction"]\')?.click()');
    await waitFor("document.querySelector(\'.maplibregl-popup-content\')");
    assert.equal(await evaluate('!!document.querySelector(".maplibregl-popup-content img, .maplibregl-popup-content script")'),false);
    assert.equal(await evaluate("window.exploited"),undefined);
    assert.equal(await evaluate("[...document.querySelectorAll('a')].some(e=>/scenarios|analytics/i.test(e.getAttribute('href')))"),false);
    await waitFor("document.querySelectorAll('.poi-marker').length===5");
    assert.equal(await evaluate("new Set([...document.querySelectorAll('.poi-marker')].map(e=>e.dataset.poiCategory)).size"),5);
    await evaluate('document.querySelector(\'button[aria-label^="Test junction"]\')?.click()');
    await delay(250);
    const poiShot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"poi-markers.png"),Buffer.from(poiShot.data,"base64"));
    console.log("Opening publication board");
    await call("Page.navigate",{url:origin+"/gantt-chart"});
    await waitFor("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Preview publication' && !e.disabled)");
    await clickText("Preview publication");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('morning')");
    assert.equal(publications,0);
    await delay(250);
    const shot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"publication-preview.png"),Buffer.from(shot.data,"base64"));
    await clickText("Confirm publication");
    await waitFor("document.body.innerText.includes('Published 2 assignments')");
    assert.equal(publications,1);
    for(const oldRoute of ["/scenarios","/analytics"]){
      await call("Page.navigate",{url:origin+oldRoute});
      await waitFor("location.pathname === '/' && document.body.innerText.includes('Unfilled posts: 2')");
    }
    await evaluate(auth("dispatcher")+"window.dispatchEvent(new Event('auth-session-changed'));");
    await waitFor("![...document.querySelectorAll('a')].some(e=>e.getAttribute('href')==='/optimization')");
    await call("Page.removeScriptToEvaluateOnNewDocument",{identifier:authScript.identifier});
    await evaluate("localStorage.clear()");
    await call("Page.navigate",{url:origin+"/login"});
    await waitFor("document.body.innerText.includes(\'Sign In to System\')");
    assert.equal(errors.length,0,errors.join("\n"));
    console.log("Browser PASS: dashboard, malicious saved text, publication preview/confirmation, removed routes, dispatcher actions; timezone America/Los_Angeles.");
    console.log("Screenshots: "+path.join(artifacts,"poi-markers.png")+" and "+path.join(artifacts,"publication-preview.png"));
    await call("Browser.close").catch(()=>{});
  } finally {
    ws?.close(); browser.kill(); server.close();
    // Leave the isolated profile in the system temp directory; no user browser profile is touched.
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
