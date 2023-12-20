const TeleBot = require('telebot');
const axios = require('axios');
const stream = require('stream');
const { promisify } = require('util');
const { createWriteStream } = require('fs');
const fs = require('fs');
const { pipeline } = require('stream');
const path = require('path');
const streamPipeline = promisify(pipeline);
const { Buffer } = require('buffer');

const urls = [
  "https://de58-3-135-152-169.ngrok-free.app" //CUALQUIER URL DE STABLE DIFFUSION
]

const GLOBAL_TOKEN_BOT = process.env.MarIA //TOKEN DE TU BOT TELEGRAM
const bot = new TeleBot({
  token: GLOBAL_TOKEN_BOT
});

let lora = false
let width = 1024
let height = 1240
let hr_state = true
let hr_scale = 2
let hr_strenght = 0.5
let adetailer = true

let real_payload = {
  "negative_prompt": "ugly, poor quality, worst quality, extra digits, fewer digits, bad aesthetic, bad anatomy, extra arms, extra legs, film grain, onfocused, blurry",
  "CLIP_stop_at_last_layers": 2,
  "width": width,
  "height": height,
  "enable_hr": hr_state,
  "denoising_strength": hr_strenght,
  "hr_scale": hr_scale,
  "hr_upscaler": "4xUltrasharp",
  "do_not_save_samples": true,
  "do_not_save_grid": true,
};

if (adetailer) {
  real_payload.alwayson_scripts = {
    "ADetailer": {
      "args": [
        // {
        //   "ad_model": "face_yolov8n.pt",
        //   "ad_confidence": 0.5
        // },
        {
          "ad_model": "mediapipe_face_full",
          "ad_confidence": 0.5
        },
        {
          "ad_model": "mediapipe_face_mesh_eyes_only",
          "ad_confidence": 0.5
        }
      ]
    }
  }
};

const proporcionMap = {
  "1:1": [1024, 1024],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "5:4": [1280, 1024],
  "4:5": [1024, 1280]
};

bot.on('text', async (msg) => {
  if (msg.text == "/hr") {
    hr_state = !hr_state
    bot.sendMessage(msg.chat.id, !hr_state ? "<b>HighRes Fix</b>: Apagado 👎" : "<b>HighRes Fix</b>: Encendido 👍")
  }
  if (msg.text == "/adetailer") {
    adetailer = !adetailer
    bot.sendMessage(msg.chat.id, !adetailer ? "<b>After Detailer</b>: Apagado 👎" : "<b>After Detailer</b>: Encendido 👍", { parseMode: "HTML" })
  }
  const arMatch = msg.text.match(/\/ar (.+)/);
  if (arMatch) {
    const proporcion = arMatch[1];
    procesarComandoAR(msg, proporcion);
  }
})

function procesarComandoAR(msg, proporcion) {
  if (proporcion in proporcionMap) {
    const [newWidth, newHeight] = proporcionMap[proporcion];
    width = newWidth;
    height = newHeight;
    bot.sendMessage(msg.chat.id, `<b>Ancho actual</b> ↔️: ${width}\n<b>Altura actual</b> ↕️: ${height}`, { parseMode: "HTML" });
  } else {
    bot.sendMessage(msg.chat.id, "Proporción no válida ‼️.\nLas opciones son: <b>1:1</b>, <b>4:3</b>, <b>3:4</b>, <b>5:4</b>, <b>4:5</b>", { parseMode: "HTML" });
  }
}

for (const url of urls) {
  bot.on('text', async (msg) => {
    try {
      const msgText = msg.text.trim();
      const prefix = "/imagine ";
      if (!msgText.startsWith(prefix)) {
        return;
      }

      const prompt = msgText.slice(prefix.length).trim();
      let ultimaPalabra = prompt.split(" ").pop();
      let cantidad = isNaN(ultimaPalabra) ? 1 : parseInt(ultimaPalabra, 10);
      let payload = real_payload
      cantidad = Math.min(cantidad, 4);

      cantidad = Math.max(cantidad, 1);
      let nuevoPrompt = ""
      if (!isNaN(ultimaPalabra)) {
        const palabras = prompt.split(" ");
        cantidad = Math.min(cantidad, palabras.length);

        palabras.splice(-cantidad, cantidad);
        nuevoPrompt = palabras.join(" ");
        payload.prompt = nuevoPrompt;
      } else {

        payload.prompt = prompt;
      }
      payload.n_iter = cantidad
      let texto = cantidad == 1 ? "Aguarda mientras generamos tu imagen! 😻" : "Aguarda mientras generamos tus " + cantidad + " imagenes! 😻"
      try {
        payload = await obtenerDatos(payload, url);
      } catch (error) {
        console.error("Error al obtener datos:", error.message);
        texto = "<b>No hay generadores disponibles! 😢</b>"
        bot.sendMessage(msg.chat.id, texto, { parseMode: "HTML", replyToMessage: msg.message_id });
        return;
      }
      bot.sendMessage(msg.chat.id, texto);
      const imageBuffers = await processImages(payload, url);
      imageBuffers.forEach((img, i) => {
        let documentOptions = { fileName: mejorarNombre(prompt), parseMode: "HTML" };
        if (i == imageBuffers.length - 1) {
          documentOptions.caption = "<b>Prompt</b> 🖌:\n" + nuevoPrompt + "\n\n<b>Modelo</b> 🖌: \n" + payload.modelo.split('.')[0]
          documentOptions.replyToMessage = msg.message_id;
        }
        bot.sendDocument(msg.chat.id, img, documentOptions);
      });
    } catch (error) {
      console.error('Error:', error);
      bot.sendMessage(msg.chat.id, 'Hubo un error al procesar la solicitud.');
    }
  });
}

async function saveImage(readableStream, outputPath) {
  let index = 0;
  let finalPath = outputPath;
  while (fs.existsSync(finalPath)) {
    index++;
    finalPath = outputPath.replace(/\[(\d+)\]/, `[${index}]`);
  }
  await streamPipeline(
    readableStream,
    createWriteStream(finalPath)
  );
  console.log(`Guardado en: ${finalPath}`);
}
async function processImages(payload, url) {
  try {
    const response = await axios.post(`${url}/sdapi/v1/txt2img`, payload, { timeout: undefined });
    const images = response.data.images;
    const buffers = [];
    for (let index = 0; index < images.length; index++) {
      const img = images[index];
      const imageBuffer = Buffer.from(img, 'base64');
      buffers.push(imageBuffer);

      const readableStream = new stream.Readable();
      readableStream.push(imageBuffer);
      readableStream.push(null);
      const fileName = `${mejorarNombre(payload.prompt, index)}`;
      const outputPath = path.join('C:', 'Users', 'July', 'Pictures', 'sageai', fileName);
      await saveImage(readableStream, outputPath);
    }
    return buffers;
  } catch (error) {
    console.error('Error en processImages:', error);
    throw error;
  }
}


function mejorarNombre(fileName, indice = 0) {
  const sanitizedFileName = fileName.replace(/[^\w\s.-]/g, '');
  const words = sanitizedFileName.split(/\s+/).slice(0, 10);
  return `${words.join(' ')}[${indice}].png`;
}

async function obtenerDatos(pl, url) {
  try {
    const response = await axios.get(url + "/sdapi/v1/sd-models");
    pl.modelo = response.data.map((modelo) => modelo.title)[0];
    console.log(pl.modelo);
    if (pl.modelo.includes('pixel') || pl.modelo.includes('dreamshaper')) {
      if (lora) {
        pl.prompt = pl.prompt + ". <lora:add-detail-xl:2>, <lora:DetailedEyes_V3:1>, <lora:sdxl_neg_overfit_v1:1>";
      } else {
        pl.prompt = pl.prompt;
      }
      pl.steps = 4;
      pl.cfg_scale = 2;
      pl.sampler_name = "DPM++ SDE Karras";
    } else if (pl.modelo.includes('Realities')) {
      pl.steps = 5;
      pl.cfg_scale = 2;
      pl.sampler_name = "DPM++ 2M SDE";
    } else if (pl.modelo.includes('REDTEAM')) {
      pl.steps = 6;
      pl.cfg_scale = 2;
      pl.sampler_name = "DPM++ 2M Karras";
    } else if (pl.modelo.includes('dreamshaperXL')) {
      pl.steps = 7;
      pl.cfg_scale = 1.5;
      pl.sampler_name = "DPM++ SDE Karras";
    } else if (pl.modelo.includes('SuperFastXL')) {
      pl.steps = 5;
      pl.cfg_scale = 2;
      pl.sampler_name = "DPM++ SDE Karras";
    } else if (pl.modelo.includes('am_i_real')) {
      pl.negative_prompt = pl.negative_prompt + ". bad-hands-5, bad_prompt_version2, EasyNegativeV2";
      pl.steps = 7;
      pl.cfg_scale = 1.5;
      pl.width = width / 2;
      pl.height = height / 2;
      pl.hr_scale = hr_scale;
      pl.prompt = pl.prompt + ". <lora:lcm-lora-sdv1-5:1> ";
      pl.sampler_name = "LCM";
    } else if (pl.modelo.includes('sxz_luma')) {
      pl.prompt = pl.prompt + " <lora:lcm-lora-sdv1-5:1>";
      pl.negative_prompt = pl.negative_prompt + ". bad-hands-5, bad_prompt_version2, EasyNegativeV2";
      pl.steps = 7;
      pl.cfg_scale = 1.5;
      pl.width = width / 2;
      pl.height = height / 2;
      pl.hr_scale = hr_scale;
      pl.sampler_name = "LCM";
    } else if (pl.modelo.includes('epic_photo')) {
      pl.prompt = pl.prompt + ". <lora:add_detail:1>, <lora:lcm-lora-sdv1-5:1>";
      pl.negative_prompt = pl.negative_prompt + "nude, nudity, nsfw, nipples, pussy. bad-hands-5, bad_prompt_version2, EasyNegativeV2";
      pl.steps = 5;
      pl.cfg_scale = 1;
      pl.width = width / 2;
      pl.height = height / 2;
      pl.hr_scale = hr_scale;
      pl.sampler_name = "LCM";
    }
    return pl;
  } catch (error) {
    console.error('Error en obtenerDatos:', error);
    throw error;
  }
}


bot.start();
