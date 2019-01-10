/* Copyright 2017 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

let Canvas = require('canvas');
let assert = require('assert');
let fs = require('fs');
const archiver = require('archiver');
let mkdirp = require('mkdirp');
let pdfjsLib = require('pdfjs-dist');


/**
 * @param {String} source
 * @param {String} out
 * @returns {Promise}
 */
async function zipDirectory(source, out) {
  const archive = archiver('zip', { zlib: { level: 9 }});
  const stream = fs.createWriteStream(out);

  return new Promise((resolve, reject) => {
    archive
      .directory(source, false)
      .on('error', err => reject(err))
      .pipe(stream)
    ;

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

function NodeCanvasFactory() {}
NodeCanvasFactory.prototype = {
  create: function NodeCanvasFactory_create(width, height) {
    assert(width > 0 && height > 0, 'Invalid canvas size');
    let canvas = Canvas.createCanvas(width, height);
    let context = canvas.getContext('2d');
    return {
      canvas: canvas,
      context: context,
    };
  },

  reset: function NodeCanvasFactory_reset(canvasAndContext, width, height) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');
    assert(width > 0 && height > 0, 'Invalid canvas size');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },

  destroy: function NodeCanvasFactory_destroy(canvasAndContext) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');

    // Zeroing the width and height cause Firefox to release graphics
    // resources immediately, which can greatly reduce memory consumption.
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  },
};

async function convertPageToImages(dir, pdfDocument, pageIndex) {
  return new Promise((resolve, reject) => {
    pdfDocument.getPage(pageIndex).then(function (page) {
      // Render the page on a Node canvas with 100% scale.
      let viewport = page.getViewport({ scale: 2.0, });
      let canvasFactory = new NodeCanvasFactory();
      let upperCroppedCanvas = canvasFactory.create(viewport.width, viewport.height / 2);
      let lowerCroppedCanvas = canvasFactory.create(viewport.width, viewport.height / 2);
      let canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
      let renderContext = {
        canvasContext: canvasAndContext.context,
        viewport: viewport,
        canvasFactory: canvasFactory,
      };

      let renderTask = page.render(renderContext);
      renderTask.promise.then(function() {
        let sourceWidth = viewport.width;
        let sourceHeight = viewport.height / 2;
        let destWidth = sourceWidth;
        let destHeight = sourceHeight;

        upperCroppedCanvas.context.drawImage(canvasAndContext.canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, destWidth, destHeight);
        lowerCroppedCanvas.context.drawImage(canvasAndContext.canvas, 0, viewport.height / 2, sourceWidth, sourceHeight, 0, 0, destWidth, destHeight);
        // Convert the canvas to an image buffer.

        let image = upperCroppedCanvas.canvas.toBuffer();
        fs.writeFile(`${dir}/${pageIndex}_a.png`, image, (error) => {
          if (error) {
            console.error('Error: ' + error);
            reject();
          } else {
            // Convert the canvas to an image buffer.
            // let image = canvasAndContext.canvas.toBuffer();
            let image = lowerCroppedCanvas.canvas.toBuffer();
            fs.writeFile(`${dir}/${pageIndex}_b.png`, image, (error) => {
              if (error) {
                console.error('Error: ' + error);
                reject();
              } else {
                resolve();
              }
            });
          }
        });
      });
    });
  });
}


if (process.argv.length < 4) {
  console.log("usage: node pdf2png.js [stack name] [pdf file]")
  process.exit(1)
}

let stackName = process.argv[2];
let packageName = stackName.replace("/", "_");

let dir = `./${packageName}/Archive/Groups/${stackName}`;
let pdfName = process.argv[3];

let dirPromise = new Promise((resolve, reject) => {
  if (!fs.existsSync(dir)){
      mkdirp(dir, resolve);
  }else {
    resolve();
  }
})

// Relative path of the PDF file.

// Read the PDF file into a typed array so PDF.js can load it.
let rawData = new Uint8Array(fs.readFileSync(pdfName));

// Load the PDF file.
let loadingTask = pdfjsLib.getDocument(rawData);
Promise.all([loadingTask.promise, dirPromise]).then(async function(pdfDocument) {
  pdfDocument = pdfDocument[0]
  // Get the first page.
  // ignore first page?
  for (i = 1; i <= pdfDocument.numPages; i++) {
    console.log(`Converting page ${i}`)
    await convertPageToImages(dir, pdfDocument, i)
  }

  // console.log("zipping")
  // let csvFile = fs.createWriteStream(`${dir}/Data.csv`);
  // csvFile.write("1 Text, 1 Image, 2 Text, 2 Image\n")
  // for (i = 1; i <= pdfDocument.numPages; i++) {
  //   csvFile.write(`,${i}_a.png,,${i}_b.png\n`)
  // }
  // csvFile.end()
  //
  // await zipDirectory(packageName, `${packageName}.studyarch`)
  // console.log("Done")

}).catch(function(reason) {
  console.log(reason);
});
