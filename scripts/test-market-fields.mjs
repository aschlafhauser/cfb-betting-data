import assert from 'node:assert/strict';
import {americanMoneyline,espnMoneyline} from './espn-market-fields.mjs';
assert.equal(espnMoneyline({moneyline:{home:{close:{odds:'+2000'},open:{odds:'+2200'}},away:{close:{odds:'-6500'}}}},'home'),'+2000');
assert.equal(espnMoneyline({moneyline:{away:{close:{odds:'-6500'}}}},'away'),'-6500');
assert.equal(espnMoneyline({awayTeamOdds:{moneyLine:160}},'away'),'+160');
assert.equal(espnMoneyline({moneyline:{home:{open:{odds:'+2200'}}}},'home'),null,'Opening odds must never become a current quote');
for(const missing of [null,undefined,'','—','+4.5',0,'pending'])assert.equal(americanMoneyline(missing),null);
console.log('Market field regression PASS: nested current ESPN moneylines, legacy prices, missing values and opening-price isolation.');
