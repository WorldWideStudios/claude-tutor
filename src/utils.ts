const TAX_RATE = 0.08;

function calculateTotal(price: number): number {
  return price * (1 + TAX_RATE);
}

function calculateDiscount(price: number): number {
  return price * TAX_RATE;
}
