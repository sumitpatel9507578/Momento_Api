const MESSAGE_TYPES = new Set([
  "text",
  "image",
  "video",
  "audio",
  "file",
  "reel",
  "post",
]);

function isValidMessageType(messageType) {
  return MESSAGE_TYPES.has(messageType);
}

module.exports = { MESSAGE_TYPES, isValidMessageType };
