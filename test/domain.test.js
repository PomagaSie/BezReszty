import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents, validAliorIban, accountMatches, passwordHash, passwordMatches } from '../src/domain.js';
import { parseAlior } from '../src/bank.js';
import { iban } from './helpers.js';
test('money uses exact integer grosze and rejects rounding/scientific notation/negative values',()=>{
  assert.equal(toCents('1 234,56'),123456);assert.equal(toCents('0.29'),29);assert.equal(toCents('50'),5000);
  for(const value of ['1.001','-3','1e4','NaN','','500.000.00'])assert.throws(()=>toCents(value));
});
test('Alior IBAN checksum and bank identifier are validated',()=>{
 assert.equal(validAliorIban(iban),true);assert.equal(validAliorIban('PL'+iban),true);
 assert.equal(validAliorIban('00'+iban.slice(2)),false);assert.equal(validAliorIban('12105000997603123456789123'),false);
 assert.equal(accountMatches('96...0001',iban),true);assert.equal(accountMatches('96...9999',iban),false);assert.equal(accountMatches('...5420',iban),false);
});
test('passwords use salted scrypt and constant-time hash comparison',async()=>{
 const a=await passwordHash('haslo-do-testow-123'),b=await passwordHash('haslo-do-testow-123');
 assert.notEqual(a,b);assert.equal(await passwordMatches('haslo-do-testow-123',a),true);assert.equal(await passwordMatches('inne',a),false);
});
test('Alior parser supports HTML/plain text and requires consistent subject/body amount',()=>{
 const subject='Uznanie rachunku 96...0001 kwotą 1 234,56 PLN';
 const html='Rachunek uznany kwotą 1 234,56 PLN.<br/>Nadawca: TESTOWY NADAWCA<br/>Tytuł zlecenia: BR-AABBCCDDEEFF<br/>Saldo: 9 PLN';
 assert.deepEqual(parseAlior(subject,html),{accountMask:'96...0001',amount:123456,sender:'TESTOWY NADAWCA',title:'BR-AABBCCDDEEFF'});
 assert.equal(parseAlior(subject,html.replace('1 234,56','1 200,00')),null);
 assert.equal(parseAlior('Obciążenie rachunku 96...0001',html),null);
 assert.equal(parseAlior(subject,html.replaceAll('<br/>','\n')).amount,123456);
});
