const { builder } = require("@netlify/functions");
const OgImageHtml = require("./ogImageHtml.js");

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
const FALLBACK_IMAGE_FORMAT = "png";
const ERROR_URL_SEGMENT = "onerror";

function getErrorImage(message, statusCode, ttl, cacheBuster, returnEmptyImageWhenNotFound = false) {
  let obj = {
    // We need to return 200 here or Firefox won’t display the image
    // HOWEVER a 200 means that if it times out on the first attempt it will stay the default image until the next build.
    statusCode,
    // HOWEVER HOWEVER, we can set a ttl of 60 which means that the image will be re-requested in 24 hours.
    ttl,
    headers: {
      "x-error-message": message,
      "x-cache-buster": cacheBuster,
    },
  };

  // Use case: we want to remove the `<img>` clientside when an OG image is not found.

  // Notes:
  // Builder functions *do* cache 404s (not 50x) but not all browsers trigger `<img onerror>`
  // Also tried: Both 301 and 302 redirects in image sources (to a `/not-found/` URI) but are not reflected in clientside .src or .currentSrc
  // So to trigger `<img onerror>` on a 404 we *cannot* return valid image content
  if(!returnEmptyImageWhenNotFound) {
    obj.headers['content-type'] = "image/svg+xml";
    obj.body = `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" x="0" y="0" viewBox="0 0 1569.4 2186" xml:space="preserve" aria-hidden="true" focusable="false"><style>.st0{fill:#bbb;stroke:#bbb;stroke-width:28;stroke-miterlimit:10}</style></svg>`;
    obj.isBase64Encoded = false;
  }

  return obj;
}

async function handler(event, context) {
  // /:url/:size/:format/
  // e.g. /https%3A%2F%2Fwww.11ty.dev%2F/
  let pathSplit = event.path.split("/").filter(entry => !!entry);
  let [url, size, imageFormat, returnEmptyImage, cacheBuster] = pathSplit;

  url = decodeURIComponent(url);

  // Whether or to return empty image content
  let returnEmptyImageWhenNotFound = false;

  // Manage your own frequency by using a _ prefix and then a hash buster string after your URL
  // e.g. /https%3A%2F%2Fwww.11ty.dev%2F/_20210802/ and set this to today’s date when you deploy
  if(size) {
    if(size.startsWith("_")) {
      cacheBuster = size;
      size = undefined;
    } else if(size === ERROR_URL_SEGMENT) {
      returnEmptyImageWhenNotFound = true;
      size = undefined;
    }
  }

  if(imageFormat) {
    if(imageFormat.startsWith("_")) {
      cacheBuster = imageFormat;
      imageFormat = undefined;
    } else if(imageFormat === ERROR_URL_SEGMENT) {
      returnEmptyImageWhenNotFound = true;
      imageFormat = undefined;
    }
  }

  if(returnEmptyImage) {
    if(returnEmptyImage.startsWith("_")) {
      cacheBuster = returnEmptyImage;
    } else if(returnEmptyImage === ERROR_URL_SEGMENT) {
      returnEmptyImageWhenNotFound = true;
    }
  }

  try {
    // output to Function logs
    let maxWidth = IMAGE_WIDTH;
    if(size === "tiny") {
      maxWidth = 150;
    } else if(size === "small") {
      maxWidth = 375;
    } else if(size === "medium") {
      maxWidth = 650;
    }

    console.log( {url, size, imageFormat, cacheBuster} );

    let og = new OgImageHtml(url);
    await og.fetch();

    let imageUrls = await og.getImages();
    if(!imageUrls.length) {
      return getErrorImage(`No Open Graph images found for ${url}`, 200, 60 * 60 * 24, cacheBuster, returnEmptyImageWhenNotFound);
    }

    // TODO: when requests to https://v1.screenshot.11ty.dev/ show an error (the default SVG image)
    // this service should error with _that_ image and the error message headers.
    let stats = await og.optimizeImage(imageUrls[0], imageFormat || FALLBACK_IMAGE_FORMAT, maxWidth);
    let format = Object.keys(stats).pop();
    let stat = stats[format][0];

    console.log( "Found match", url, format, stat );

    return {
      statusCode: 200,
      headers: {
        "content-type": stat.sourceType,
        "x-cache-buster": cacheBuster,
      },
      body: stat.buffer.toString("base64"),
      isBase64Encoded: true
    };
  } catch (error) {
    console.log("Error", error);
    return getErrorImage(error.message, 200, 60 * 5, cacheBuster);
  }
}

exports.handler = builder(handler);
