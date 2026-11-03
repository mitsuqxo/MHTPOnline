/* Search, downloadable forms and inquiry form */
(function(){
var $=function(i){return document.getElementById(i)};
var navbtn=$('navbtn'),nav=$('mainnav');
var mobileNav=window.matchMedia('(max-width:760px)');
if(navbtn&&nav&&mobileNav.matches)nav.hidden=true;
if(navbtn&&nav)navbtn.onclick=function(){
  var open=nav.hidden=!nav.hidden;
  navbtn.setAttribute('aria-expanded',String(open));
  navbtn.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
};
if(nav&&navbtn)nav.querySelectorAll('a').forEach(function(a){a.onclick=function(){if(mobileNav.matches){nav.hidden=true;navbtn.setAttribute('aria-expanded','false');navbtn.setAttribute('aria-label','Open navigation menu')}}});
mobileNav.addEventListener('change',function(event){if(!nav||!navbtn)return;if(event.matches){nav.hidden=true;navbtn.setAttribute('aria-expanded','false')}else{nav.hidden=false}});
$('inq').onsubmit=function(e){e.preventDefault();var f=e.target.elements,g=function(n){return f[n].value},a=document.createElement('a');a.href='mailto:mhtpbatangas@gmail.com?subject='+encodeURIComponent(g('topic')+' inquiry from '+g('name'))+'&body='+encodeURIComponent(g('msg'))+'%0A%0A'+encodeURIComponent('Name: '+g('name')+' / Contact: '+g('contact'));a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();a.remove();$('inqmsg').hidden=false};
var galleryImage=$('gallery-image'),galleryCaption=$('gallery-caption'),galleryFrame=$('gallery-frame'),galleryNext=$('gallery-next');
if(galleryImage&&galleryCaption&&galleryFrame&&galleryNext){
  var galleryPhotos=[
    {src:'images/church.jpg',alt:'Facade of the Most Holy Trinity Parish church',caption:'Our parish church, Simbahan ng Santisima Trinidad',seal:false},
    {src:'images/logo.png',alt:'Parish seal',caption:'The parish seal',seal:true}
  ],galleryIndex=0,galleryTimer,galleryFadeTimer;
  var showPhoto=function(index){
    galleryIndex=(index+galleryPhotos.length)%galleryPhotos.length;
    window.clearTimeout(galleryFadeTimer);
    galleryFrame.classList.add('is-changing');
    var photo=galleryPhotos[galleryIndex],preload=new Image();
    preload.onload=function(){
      galleryFadeTimer=window.setTimeout(function(){
        galleryImage.src=photo.src;galleryImage.alt=photo.alt;galleryCaption.textContent=photo.caption;
        galleryImage.classList.toggle('seal',photo.seal);
        galleryFrame.classList.remove('is-changing');
      },260);
    };
    preload.onerror=function(){galleryFrame.classList.remove('is-changing')};
    preload.src=photo.src;
  };
  var nextPhoto=function(){showPhoto(galleryIndex+1);window.clearInterval(galleryTimer);galleryTimer=window.setInterval(nextPhoto,5000)};
  galleryNext.onclick=nextPhoto;
  galleryTimer=window.setInterval(nextPhoto,5000);
}
})();
