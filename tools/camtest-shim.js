(function(){
  var ready=false, stream=null;
  // ?chart=warm｜cool｜green：在臉旁邊畫一張 ColorChecker 24 色卡，整個畫面套上那種燈光的色偏
  // （用來在沒有實體色卡時，測 _chart.html 標位置 → 主程式讀色卡校正 的整條流程）
  var q=/[?&]chart=(\w+)/.exec(location.search), cast=q&&q[1];
  var LIGHTS={warm:[1.25,0.95,0.52], cool:[0.95,1.0,1.08], green:[0.92,1.1,0.9], none:[1,1,1]};
  var CROSS=[[0.86,0.12,0.02],[0.06,0.88,0.06],[0.02,0.12,0.86]];
  var CHART=[[115,82,68],[194,150,130],[98,122,157],[87,108,67],[133,128,177],[103,189,170],
    [214,126,44],[80,91,166],[193,90,99],[94,60,108],[157,188,64],[224,163,46],
    [56,61,150],[70,148,73],[175,54,60],[231,199,31],[187,86,149],[8,133,161],
    [243,243,242],[200,200,200],[160,160,160],[122,122,121],[85,85,85],[52,52,52]];
  // 色卡在原始（未鏡像）畫面左下角；主程式畫面左右翻轉後會出現在右下
  var CH={x:14,y:760,w:216,h:144};
  window.__CAMTEST_CHART__=cast?{cast:cast,rect:CH,W:1280,H:960}:null;
  var img=new Image();
  img.onload=function(){
    var c=document.createElement('canvas'); c.width=1280; c.height=960;
    var x=c.getContext('2d');
    var sw=176, sh=211, k=960/sh, dw=sw*k, dx=(1280-dw)/2;
    var still=document.createElement('canvas'); still.width=1280; still.height=960;
    var s=still.getContext('2d');
    s.fillStyle='#20303f'; s.fillRect(0,0,1280,960);
    s.drawImage(img,780,232,sw,sh,dx,0,dw,960);
    if(cast){
      s.fillStyle='#161616'; s.fillRect(CH.x-6,CH.y-6,CH.w+12,CH.h+12);
      var cw=CH.w/6, chh=CH.h/4;
      CHART.forEach(function(p,i){ s.fillStyle='rgb('+p+')';
        s.fillRect(CH.x+(i%6)*cw+2, CH.y+Math.floor(i/6)*chh+2, cw-4, chh-4); });
      var light=LIGHTS[cast]||LIGHTS.warm, expo=0.85;
      var LIN=new Float32Array(256);
      for(var i=0;i<256;i++){ var v=i/255; LIN[i]=v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4); }
      var ENC=new Uint8Array(4097);
      for(i=0;i<=4096;i++){ v=i/4096; ENC[i]=Math.round(255*(v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055)); }
      var id=s.getImageData(0,0,1280,960), d=id.data;
      for(i=0;i<d.length;i+=4){
        var r=LIN[d[i]]*light[0]*expo, g=LIN[d[i+1]]*light[1]*expo, b=LIN[d[i+2]]*light[2]*expo;
        for(var ch=0;ch<3;ch++){ var o=CROSS[ch][0]*r+CROSS[ch][1]*g+CROSS[ch][2]*b;
          d[i+ch]=ENC[Math.max(0,Math.min(4096,Math.round(o*4096)))]; }
      }
      s.putImageData(id,0,0);
    }
    (function draw(){ x.drawImage(still,0,0); requestAnimationFrame(draw); })();
    stream=c.captureStream(30); ready=true;
  };
  // 相對路徑：GitHub Pages 的網站放在 /倉庫名/ 底下，寫成 /images/… 會找不到
  img.src='images/_source/face_e1tw71e1tw71e1tw.jpg';
  navigator.mediaDevices.getUserMedia=function(){
    return new Promise(function(res,rej){
      var t=setInterval(function(){ if(ready){clearInterval(t); res(stream);} },50);
      setTimeout(function(){clearInterval(t); rej(new Error('timeout'));},6000);
    });
  };
})();
