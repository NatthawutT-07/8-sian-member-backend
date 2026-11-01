export function priceItems(items, products) {
  if (new Set(items.map((i) => i.productId)).size !== items.length)
    throw new Error('รายการสินค้าซ้ำ');
  const lines = items.map((item) => {
    const p = products.find((p) => p.id === item.productId && p.active);
    if (!p) throw new Error('สินค้าไม่พร้อมขาย กรุณาโหลดรายการใหม่');
    const group = p.group || 'MAIN';
    if (group === 'DISCOUNT' && item.quantity !== 1)
      throw new Error('รายการส่วนลดเลือกได้รายการละหนึ่งครั้งต่อบิล');
    return {
      productId: p.id,
      name: p.name,
      barcode: p.barcode,
      priceSatang: p.priceSatang,
      quantity: item.quantity,
      group,
    };
  });
  if (!lines.some((i) => i.group !== 'DISCOUNT'))
    throw new Error('กรุณาเพิ่มสินค้าหลักหรือโปรโมชั่นก่อนใช้ส่วนลด');
  const totalSatang = lines.reduce((sum, i) => sum + i.priceSatang * i.quantity, 0);
  if (!Number.isSafeInteger(totalSatang) || totalSatang < 0 || totalSatang > 100000000)
    throw new Error('ยอดบิลหรือส่วนลดไม่ถูกต้อง');
  return { lines, totalSatang };
}
