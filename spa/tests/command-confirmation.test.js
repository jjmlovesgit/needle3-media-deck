import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandConfirmationPolicy,clampConfidenceThreshold,shouldConfirmCommand} from '../app/scripts/command-confirmation.js';

test('confidence threshold is bounded and defaults safely',()=>{
 assert.equal(clampConfidenceThreshold(-5),0);
 assert.equal(clampConfidenceThreshold(140),100);
 assert.equal(clampConfidenceThreshold('bad'),70);
});

test('commands below the threshold require confirmation',()=>{
 assert.equal(shouldConfirmCommand(.694,70),true);
 assert.equal(shouldConfirmCommand(.695,70),false,'displayed 70% meets a 70% threshold');
 assert.equal(shouldConfirmCommand(.70,70),false);
 assert.equal(shouldConfirmCommand(undefined,70),true);
});

test('policy restores and persists the selected threshold',()=>{
 const saved=[];
 const policy=new CommandConfirmationPolicy({read:()=> '82',save:(key,value)=>saved.push([key,value])});
 assert.equal(policy.threshold,82);
 assert.equal(policy.requiresConfirmation(.81),true);
 assert.equal(policy.setThreshold(55),55);
 assert.deepEqual(saved,[['commandConfidenceThreshold',55]]);
});
