(function(){
  var ready=false, stream=null;
  var img=new Image();
  img.onload=function(){
    var c=document.createElement('canvas'); c.width=1280; c.height=960;
    var x=c.getContext('2d');
    var sw=176, sh=211, k=960/sh, dw=sw*k, dx=(1280-dw)/2;
    (function draw(){ x.fillStyle='#20303f'; x.fillRect(0,0,1280,960);
      x.drawImage(img,780,232,sw,sh,dx,0,dw,960); requestAnimationFrame(draw); })();
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
