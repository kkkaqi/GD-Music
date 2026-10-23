'use strict';
const MIME_EXT = { 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mp4': 'm4a',
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'video/mp4': 'm4a',
  'audio/aac': 'aac', 'audio/aacp': 'aac', 'audio/ape': 'ape', 'audio/x-ape': 'ape',
  'audio/alac': 'alac', 'audio/x-alac': 'alac', 'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff' };
const AUDIO_EXTENSIONS = new Set(['mp3','flac','m4a','ogg','wav','webm','aac','ape','alac','aiff','aif','audio']);
function audioExtension(address, type = '', fallback = 'mp3', prefix) {
  // 部分网易 FLAC 链接使用 .mp3 和 audio/mpeg，文件签名比响应声明可靠。
  if (prefix?.[0] === 0x66 && prefix[1] === 0x4c && prefix[2] === 0x61 && prefix[3] === 0x43) return 'flac';
  let fromUrl = '', queryType = '';
  try {
    const url = new URL(address);
    fromUrl = url.pathname.match(/\.(mp3|flac|m4a|ogg|wav|webm|mp4|m4s|aac|ape|alac|aiff|aif)$/i)?.[1]?.toLowerCase() || '';
    if (['mp4', 'm4s'].includes(fromUrl)) fromUrl = 'm4a';
    queryType = url.searchParams.get('mime') || '';
  } catch {}
  const cleanType = value => String(value).split(';')[0].trim().toLowerCase();
  if (fromUrl === 'm4a') return 'm4a';
  return MIME_EXT[cleanType(type)] || fromUrl || MIME_EXT[cleanType(queryType)] || fallback;
}
module.exports = { audioExtension, AUDIO_EXTENSIONS };
