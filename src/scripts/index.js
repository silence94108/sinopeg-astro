// JavaScript Document
$(document).ready(function () {
  
  var height1 = $('.header').height();
  $(window).scroll(function () {

    if ($(window).scrollTop() > height1) {
      if (!$(".header").hasClass('header_gao')) {
        $(".header").addClass('header_gao');
        $(".header_er").addClass('header_di');
      }

    } else {
      if ($(".header").hasClass('header_gao')) {
        $(".header").removeClass('header_gao');
        $(".header_er").removeClass('header_di');
      }
    }

    if ($(window).scrollTop() + $(window).height() == $(document).height()) {
      $(".fu_box1").show();
      $(".fu_box2").hide();
    } else {
      $(".fu_box2").show();
      $(".fu_box1").hide();
    }
  });
});
$(function () {
  $(".search_name").each(function () {
    var maxwidth = 18;
    if ($(this).text().length > maxwidth) {
      $(this).text($(this).text().substring(0, maxwidth));
      $(this).html($(this).html() + '...');
    }
  });
  $(".search_text font").each(function () {
    var maxwidth = 14;
    if ($(this).text().length > maxwidth) {
      $(this).text($(this).text().substring(0, maxwidth));
      $(this).html($(this).html() + '...');
    }
  });

  var a = $(".index_pro_item").length;
  // alert(a);
  if (a == 4 || a == 7 || a == 8) {
    $(".index_pro_list").addClass('index_pro_list1');
  } else if (a == 3 || a == 5 || a == 6) {
    $(".index_pro_list").addClass('index_pro_list2');
  }

  $('.index_tech_area').eq(0).show();

  $(".index_tech_item").click(function () {
    $(this).addClass("index_tech_current").siblings().removeClass("index_tech_current");
    var i = $(this).index();
    $('.index_tech_area').eq(i).show().siblings().hide();

  });

  $('.proex_block').eq(0).show();

  $(".pro_info_text").click(function () {
    $(this).addClass("pro_info_current").siblings().removeClass("pro_info_current");
    var i = $(this).index();
    $('.proex_block').eq(i).show().siblings().hide();

  });

  // $(".left_item").click(function(){

  //     $(".left_item_model").show();
  //     $(this).addClass('left_current');

  // })

  // $(".left_item_model").click(function(e){
  //     e.stopPropagation();
  //     $(".left_item_model").hide();
  //     $(this).parents('.left_item').removeClass('left_current');
  //     $('.right_area').eq(0).show().siblings().hide();
  // })
  // 
  $(".left_item > .left_info").click(function () {
    $(this).parents(".left_item").toggleClass('left_current');
  })
  $(".left_er_item .left_info span").click(function () {
    $(this).parents(".left_er_item").toggleClass('left_er_current');
  })
  // $(".left_si_item").click(function(){
  //     $(this).toggleClass('left_current');
  // })

  // $(".left_zhan_item").click(function(){
  //     var i=$(this).index();
  //     $('.right_area').eq(i).show().siblings().hide();
  // })

  $(".left_caption").click(function () {
    $(".left_list").toggle();
    $(this).toggleClass('left_caption_current');
  })
  $(".left_caption").click(function () {
    $(".tech_list").toggle();
    $(this).toggleClass('left_caption_current');
  })


  $(".footer_right_info").mouseover(function () {
    $(".fu").hide();
  })
  $(".footer_right_info").mouseout(function () {
    $(".fu").show();
  })

  // 移动端菜单展开/收起由 Header.astro 自己的脚本负责，此处不再重复绑定。








  $('.top').click(function () {
    $('html , body').animate({ scrollTop: 0 }, 'slow');
  });
  $('.header_nav').click(function () {
    // alert(1);
    $(".nav_sp").show();
    // $('.nav_block').delay(200).animate({
    //     left: "0"
    // }, 200);
    // // $('.nav_block').delay(500).fadeIn(1000);
  });
  $('.nav_close').click(function () {
    // alert(1);
    $(".nav_sp").hide();
    // $('.nav_block').delay(200).animate({
    //     left: "-50%"
    // }, 200);
    // // $('.nav_block').delay(500).fadeOut(1000);
  });

});










