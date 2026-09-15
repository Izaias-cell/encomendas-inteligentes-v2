/**
 * Utilitário puro para criação de colagens/composições de imagens no cliente (HTML5 Canvas).
 * Transforma múltiplas fotos de encomendas em lote em uma única imagem composta numerada para envio via WhatsApp.
 */

interface Slot {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Carrega uma imagem de uma URL externa ou Blob URL em um elemento HTMLImageElement.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      console.warn(`[imageCollage] Falha ao carregar imagem para colagem: ${url}`, err);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Desenha uma imagem simulando `object-fit: cover` centralizado em um retângulo de destino no Canvas.
 */
function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dWidth: number,
  dHeight: number
) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = dWidth / dHeight;

  let sx = 0;
  let sy = 0;
  let sWidth = img.naturalWidth;
  let sHeight = img.naturalHeight;

  if (imgRatio > targetRatio) {
    // Imagem mais larga que o alvo: corta as laterais
    sWidth = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sWidth) / 2;
  } else {
    // Imagem mais alta que o alvo: corta topo e base
    sHeight = img.naturalWidth / targetRatio;
    sy = (img.naturalHeight - sHeight) / 2;
  }

  ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
}

/**
 * Desenha o badge de numeração discreto e de alto contraste sobre cada foto.
 */
function drawNumberBadge(
  ctx: CanvasRenderingContext2D,
  number: number,
  slotX: number,
  slotY: number,
  baseScale: number
) {
  const badgeRadius = Math.max(18, Math.round(22 * baseScale));
  const badgeX = slotX + Math.max(16, Math.round(20 * baseScale)) + badgeRadius;
  const badgeY = slotY + Math.max(16, Math.round(20 * baseScale)) + badgeRadius;

  ctx.save();

  // Sombra suave para destacar o badge
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = Math.round(8 * baseScale);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.round(2 * baseScale);

  // Fundo do badge
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; // slate-900 translúcido
  ctx.fill();

  // Borda do badge
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(2, Math.round(2.5 * baseScale));
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Texto com número
  const fontSize = Math.max(16, Math.round(20 * baseScale));
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(number.toString(), badgeX, badgeY);

  ctx.restore();
}

/**
 * Calcula a grade e os slots para cada foto com base na quantidade total.
 */
function calculateLayout(count: number, maxWidth = 1200): { canvasWidth: number; canvasHeight: number; slots: Slot[] } {
  const gap = 6; // Divisória branca entre as fotos

  if (count === 2) {
    // Grade horizontal (2 colunas, 1 linha)
    const canvasWidth = maxWidth;
    const canvasHeight = Math.round((canvasWidth / 2) * 1.333); // Proporção ~ 3:4 por foto
    const colWidth = (canvasWidth - gap) / 2;
    const slots: Slot[] = [
      { x: 0, y: 0, width: colWidth, height: canvasHeight },
      { x: colWidth + gap, y: 0, width: colWidth, height: canvasHeight }
    ];
    return { canvasWidth, canvasHeight, slots };
  }

  if (count === 3) {
    // Composição equilibrada: 1 topo ampla + 2 embaixo
    const canvasWidth = maxWidth;
    const canvasHeight = maxWidth; // Quadrado
    const topHeight = Math.round(canvasHeight * 0.52);
    const bottomHeight = canvasHeight - topHeight - gap;
    const bottomWidth = (canvasWidth - gap) / 2;

    const slots: Slot[] = [
      { x: 0, y: 0, width: canvasWidth, height: topHeight },
      { x: 0, y: topHeight + gap, width: bottomWidth, height: bottomHeight },
      { x: bottomWidth + gap, y: topHeight + gap, width: bottomWidth, height: bottomHeight }
    ];
    return { canvasWidth, canvasHeight, slots };
  }

  if (count === 4) {
    // Grade 2 x 2
    const canvasWidth = maxWidth;
    const canvasHeight = maxWidth;
    const slotWidth = (canvasWidth - gap) / 2;
    const slotHeight = (canvasHeight - gap) / 2;

    const slots: Slot[] = [
      { x: 0, y: 0, width: slotWidth, height: slotHeight },
      { x: slotWidth + gap, y: 0, width: slotWidth, height: slotHeight },
      { x: 0, y: slotHeight + gap, width: slotWidth, height: slotHeight },
      { x: slotWidth + gap, y: slotHeight + gap, width: slotWidth, height: slotHeight }
    ];
    return { canvasWidth, canvasHeight, slots };
  }

  if (count === 5) {
    // Grade equilibrada: Linha 1 (2 fotos), Linha 2 (2 fotos), Linha 3 (1 foto ampla)
    const canvasWidth = maxWidth;
    const canvasHeight = Math.round(maxWidth * 1.35);
    const slotHeight = Math.round((canvasHeight - gap * 2) / 3);
    const halfWidth = (canvasWidth - gap) / 2;

    const slots: Slot[] = [
      { x: 0, y: 0, width: halfWidth, height: slotHeight },
      { x: halfWidth + gap, y: 0, width: halfWidth, height: slotHeight },
      { x: 0, y: slotHeight + gap, width: halfWidth, height: slotHeight },
      { x: halfWidth + gap, y: slotHeight + gap, width: halfWidth, height: slotHeight },
      { x: 0, y: (slotHeight + gap) * 2, width: canvasWidth, height: slotHeight }
    ];
    return { canvasWidth, canvasHeight, slots };
  }

  if (count === 6) {
    // Grade 2 x 3
    const canvasWidth = maxWidth;
    const canvasHeight = Math.round(maxWidth * 1.4);
    const slotWidth = (canvasWidth - gap) / 2;
    const slotHeight = (canvasHeight - gap * 2) / 3;

    const slots: Slot[] = [
      { x: 0, y: 0, width: slotWidth, height: slotHeight },
      { x: slotWidth + gap, y: 0, width: slotWidth, height: slotHeight },
      { x: 0, y: slotHeight + gap, width: slotWidth, height: slotHeight },
      { x: slotWidth + gap, y: slotHeight + gap, width: slotWidth, height: slotHeight },
      { x: 0, y: (slotHeight + gap) * 2, width: slotWidth, height: slotHeight },
      { x: slotWidth + gap, y: (slotHeight + gap) * 2, width: slotWidth, height: slotHeight }
    ];
    return { canvasWidth, canvasHeight, slots };
  }

  // Mais de 6 fotos: Grade automática com 3 colunas
  const cols = count > 8 ? 4 : 3;
  const rows = Math.ceil(count / cols);
  const canvasWidth = maxWidth;
  const slotWidth = (canvasWidth - gap * (cols - 1)) / cols;
  const slotHeight = Math.round(slotWidth * 1.25);
  const canvasHeight = rows * slotHeight + gap * (rows - 1);

  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (slotWidth + gap);
    const y = row * (slotHeight + gap);
    slots.push({ x, y, width: slotWidth, height: slotHeight });
  }

  return { canvasWidth, canvasHeight, slots };
}

/**
 * Cria uma única imagem composta (colagem) com base nas URLs das fotos fornecidas.
 * @param imageUrls Array contendo as URLs ou Blob URLs das imagens originais.
 * @returns Retorna um `Blob` JPEG da colagem gerada ou `null` se for apenas 1 foto ou houver erro.
 */
export async function createCollage(imageUrls: string[]): Promise<Blob | null> {
  if (!imageUrls || imageUrls.length <= 1) {
    return null;
  }

  try {
    // 1. Carregar todas as imagens
    const loadedImages = await Promise.all(imageUrls.map(url => loadImage(url)));

    // 2. Calcular geometria da colagem
    const { canvasWidth, canvasHeight, slots } = calculateLayout(loadedImages.length, 1200);

    // 3. Criar Canvas
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.warn('[imageCollage] Falha ao obter contexto 2D do canvas.');
      return null;
    }

    // Fundo branco como separador/moldura
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const baseScale = canvasWidth / 1200;

    // 4. Desenhar cada imagem em seu slot e adicionar numeração
    loadedImages.forEach((img, index) => {
      const slot = slots[index];
      if (!slot) return;

      // Desenhar a foto cobrindo o slot
      drawCoverImage(ctx, img, slot.x, slot.y, slot.width, slot.height);

      // Adicionar badge com número (1, 2, 3...)
      drawNumberBadge(ctx, index + 1, slot.x, slot.y, baseScale);
    });

    // 5. Converter canvas para Blob JPEG (qualidade 0.80)
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            console.warn('[imageCollage] toBlob retornou null.');
            resolve(null);
          }
        },
        'image/jpeg',
        0.80
      );
    });
  } catch (error) {
    console.error('[imageCollage] Erro ao gerar imagem composta:', error);
    return null;
  }
}
