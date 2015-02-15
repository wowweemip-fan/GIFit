var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var gifjs = require('gif.js');

var GATHERING_FRAMES_STATUS = 'Gathering frames…';
var RENDERING_STATUS = 'Rendering GIF…';

var calculateProgress = function( frame_gathering_progress, rendering_progress ){
	return (( frame_gathering_progress * 0.7 ) + ( rendering_progress * 0.3 )) * 100;
};

var getStatus = function( frame_gathering_progress ){
	var status = '';
	if( frame_gathering_progress < 1 ){
		status = GATHERING_FRAMES_STATUS;
	} else {
		status = RENDERING_STATUS;
	}
	return status;
};

var asyncSeek = function( video, time, callback ){
	var doneSeeking = function(){
		video.removeEventListener( 'seeked', doneSeeking );
		if( callback ) callback();
	};
	video.addEventListener( 'seeked', doneSeeking );
	video.currentTime = time;
};

var GifService = function(){
	EventEmitter.call( this );
	this._gif = null;
	this._aborted = false;
	var canvas_element = this._canvas_element = document.createElement('canvas');
	canvas_element.style.position = 'fixed';
	canvas_element.style.top = '-9001px';
	canvas_element.style.left = '-9001px';
	canvas_element.style.visibility = 'hidden';
};

inherits( GifService, EventEmitter );

GifService.prototype.createGif = function( configuration, video_element ){
	var gif_service = this;
	var canvas_element = this._canvas_element;
	var context = canvas_element.getContext('2d');
	var frame_gathering_progress = 0;

	// Clear abort token
	this._aborted = false;

	// Process configuration data
	var framerate = configuration.framerate;
	var frame_interval = 1000 / framerate;
	var start = configuration.start >= 0
		? configuration.start
		: 0;
	var end = configuration.end <= video_element.duration
		? configuration.end
		: video_element.duration;
	var width = configuration.width;
	var height = configuration.height;
	var quality = 31 - ( configuration.quality * 3 );
	var gif_duration = configuration.end - configuration.start;
	// To properly indicate progress we need a point of comparison locked to the frame rate
	var gif_duration_ms = Math.round( gif_duration * 1000 );
	var true_gif_duration = ( gif_duration_ms - ( gif_duration_ms % frame_interval ) ) / 1000;

	// Prepare canvas
	canvas_element.setAttribute( 'width', width );
	canvas_element.setAttribute( 'height', height );

	// Pause video to prevent crazy audio artifacts
	if( !video_element.paused ){
		video_element.pause();
	}

	// Initialize GIF maker
	var gif = this._gif = new gifjs.GIF({
		workers: 8,
		quality: quality,
		repeat: 0,
		width: width,
		height: height,
		workerScript: chrome.runtime.getURL('scripts/vendor/gif.worker.js')
	});
	gif.on( 'finished', function( image_blob ){
		gif_service.emit( 'complete', image_blob );
		gif_service._gif = null;
	});
	gif.on( 'progress', function( progress_ratio ){
		var overall_progress = calculateProgress( frame_gathering_progress, progress_ratio );
		var status = getStatus( frame_gathering_progress );
		gif_service.emit( 'progress', status, overall_progress );
	});

	// Run frames through GIF maker
	asyncSeek( video_element, start, function(){
		var addFrame = function(){
			if( gif_service._aborted ) return;
			var current_time = video_element.currentTime;
			if( current_time > end ){
				// render the GIF
				gif.render();
				return;
			}
			context.drawImage( video_element, 0, 0, width, height );
			gif.addFrame( canvas_element, {
				delay: frame_interval,
				copy: true
			});
			frame_gathering_progress = ( current_time - start ) / true_gif_duration;
			var overall_progress = calculateProgress( frame_gathering_progress, 0 );
			var status = getStatus( frame_gathering_progress );
			gif_service.emit( 'progress', status, overall_progress );
			var next_frame_time = current_time + ( 1 / framerate );
			asyncSeek( video_element, next_frame_time, addFrame );
		};
		addFrame();
	});
};

GifService.prototype.abort = function(){
	if( !this._gif ){
		return;
	}
	this._aborted = true;
	this._gif.abort();
	this._gif = null;
	this.emit('abort');
};

GifService.prototype.destroy = function(){

};

module.exports = GifService;