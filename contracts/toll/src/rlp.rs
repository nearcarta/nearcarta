// Minimal RLP for EIP-1559 transactions.
pub fn enc_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 { return b.to_vec(); }
    let mut out = len_prefix(b.len(), 0x80);
    out.extend_from_slice(b);
    out
}
pub fn enc_uint(v: u128) -> Vec<u8> {
    let bytes = v.to_be_bytes();
    let first = bytes.iter().position(|x| *x != 0).unwrap_or(16);
    enc_bytes(&bytes[first..])
}
pub fn enc_list(items: &[Vec<u8>]) -> Vec<u8> {
    let body: Vec<u8> = items.concat();
    let mut out = len_prefix(body.len(), 0xc0);
    out.extend(body);
    out
}
fn len_prefix(len: usize, base: u8) -> Vec<u8> {
    if len < 56 { return vec![base + len as u8]; }
    let lb = (len as u64).to_be_bytes();
    let first = lb.iter().position(|x| *x != 0).unwrap();
    let mut out = vec![base + 55 + (8 - first) as u8];
    out.extend_from_slice(&lb[first..]);
    out
}
pub fn strip(b: &[u8]) -> &[u8] {
    let first = b.iter().position(|x| *x != 0).unwrap_or(b.len());
    &b[first..]
}
