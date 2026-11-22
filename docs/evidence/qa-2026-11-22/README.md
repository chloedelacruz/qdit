# QA seed on testnet, 2026-11-22

Five projects on the current `milestone_proof_v2` contract, driven by `packages/v2-harness/src/seed.ts` from
throwaway Friendbot accounts. Every approved milestone and every inclusion proof was then checked with
`@qdit/verify`: milestones with `verifyMilestone`, proofs with `verifyInclusion` offline and on chain.

| | |
| --- | --- |
| Contract | [`CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB`](https://stellar.expert/explorer/testnet/contract/CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB) |
| WASM hash | `bce764f43120e4ea74b692d2051b33e8be8aba6553eb23e9d9e7101605e6a900` |
| Run | 2026-11-22T22:31:44.553Z to 2026-11-22T22:35:44.995Z |
| Transactions | 133 |

## Against the SOW 3.6 targets

| Target | This run |
| --- | --- |
| At least 5 projects with a threshold of 2 or more | 5 |
| At least 20 milestones approved through the threshold | 27, each verified with `verifyMilestone` |
| The 3 refusals on chain (non-member submit, removed approver, duplicate approval) | 3: `NotMember` [`861331ac…839ac7`](https://stellar.expert/explorer/testnet/tx/861331acc5a9823895da7c3504cc0072e5a13ba4ea36227b09ffb59be6839ac7), `AlreadyApproved` [`caf98956…f758a7`](https://stellar.expert/explorer/testnet/tx/caf989565aad62f0773c25f9f1aecc3e2678bedb632ae604397a09fe9ff758a7), `NotMember` [`bf50ee71…5992fc`](https://stellar.expert/explorer/testnet/tx/bf50ee71789182215293af8a3dfe8cee9f155144278a312f37b825c43e5992fc) |
| At least 10 batches, one of at least 100 milestones | 10, the largest 128 leaves |
| At least 100 inclusion proofs verified on chain and offline | 235 (0 failed) |

## Check it yourself

```sh
cd packages && npm ci && npm run build
node verify/dist/cli.js proof ../docs/evidence/qa-2026-11-22/batches/qa-1/records/proofs/00127-record-127.json
node verify/dist/cli.js milestone --project ad605dca-7cab-491d-9d62-0d196ebc54b7 --milestone milestone-1
```

Every proof file is under `batches/<project>/<batch>/proofs/`; `run.json` holds every step and check.

## Notes

- Two earlier attempts the same day stopped before writing evidence, because of a bug in the seed: it simulated reads from an account it had only funded in qa-1. Their projects stay on the contract and appear in the replay snapshot; they are not part of this run's counts. First attempt: 049308ec-ae72-43db-bc79-852aeec48639, af357934-48f1-4483-a47a-597fcd6b21e4, f1da25a8-3107-4955-a3da-4cb3d551dc5d, 54fbcb60-1744-473a-9fa6-997cd3df3df3, bbdbdfdc-f691-4c8c-abfe-b1d52e610ab4. Second attempt: a6d5c1a9-c26b-45f9-a690-a7324d75496c, 85697634-0a06-4b4d-b815-94898a5d2143, 37216e35-866a-40ad-a1c0-493bccfd803d, fe3a3d6e-0319-46b1-b774-d97f2940b30d, cd584374-b0b0-4c97-b71f-549ff37618c8, 9bc66846-23fa-4c34-8e46-050471134b7b, a02b72a5-e7c2-4acb-8e77-5200b8794001, b7979c5c-7ac5-4265-9711-364303e6a23b, b2461a46-450a-4431-b7a8-e851b558454d.
- The 'Check it yourself' commands were re-rendered after the run: `proof` now checks on chain by default (security self-review finding M-1).

## qa-1: 2 of 3 approvers

Project id `ad605dca-7cab-491d-9d62-0d196ebc54b7`.

| Role | Account |
| --- | --- |
| owner | [`GCHE343U…FXMFOU`](https://stellar.expert/explorer/testnet/account/GCHE343UAYM2SPHWPD4FU6B3UU5ZFUOBWX75FOLUQVIFQIVBGRFXMFOU) |
| submitter | [`GB3VW5XF…7P6NNP`](https://stellar.expert/explorer/testnet/account/GB3VW5XFAH3QF2WSVHBI3ZUQ2RMWRGNTNXLJWMELUZIPATWZEC7P6NNP) |
| approver1 | [`GB7TTQQS…RU4VK4`](https://stellar.expert/explorer/testnet/account/GB7TTQQSVDAQ7SR5BAWORDXQKXTJIUKQMZBVL4OMBLNRNOSMZ2RU4VK4) |
| approver2 | [`GDP6FYPR…GGNUJU`](https://stellar.expert/explorer/testnet/account/GDP6FYPRZ2VEC62CEGENX3KCKTQ25TPIX3LOI5KIJ54JGJWFNPGGNUJU) |
| approver3 | [`GAUP4MQF…2YIEY5`](https://stellar.expert/explorer/testnet/account/GAUP4MQFTRFWZP7YBNVE6AME7CC6XXQUVC4PLPK2N5SO2X74LV2YIEY5) |
| outsider | [`GCVIPIVH…C2DZUN`](https://stellar.expert/explorer/testnet/account/GCVIPIVHDGUHLEEFW6W33ZPKFBS7ZFUK5N3Z7LQE3H452FBOSBC2DZUN) |

| # | Step | Signer | Outcome | Transaction |
| ---: | --- | --- | --- | --- |
| 1 | create_project, threshold 1 | owner | ok | [`60b83b06…6765b0`](https://stellar.expert/explorer/testnet/tx/60b83b06093e54152718ca4dd671b77bbd0cb0e21530068feba7952f406765b0) (ledger 5872620) |
| 2 | add_member approver1 as Approver | owner | ok | [`6007d237…41fdcf`](https://stellar.expert/explorer/testnet/tx/6007d23799568307f47790fc2edd04c38f9d65dc7f4ec1131bf2cb363941fdcf) (ledger 5872621) |
| 3 | add_member approver2 as Approver | owner | ok | [`1ac3a6fc…9d798c`](https://stellar.expert/explorer/testnet/tx/1ac3a6fcf83da297cd5712f6ea2863de2136e700605e12633e05068e9c9d798c) (ledger 5872622) |
| 4 | add_member approver3 as Approver | owner | ok | [`cc5dc939…f68123`](https://stellar.expert/explorer/testnet/tx/cc5dc9394c0e8b583a8e9280359769e6b7d3160f4129e5bc90ea9be424f68123) (ledger 5872623) |
| 5 | add_member submitter as Submitter | owner | ok | [`3ec506bc…402971`](https://stellar.expert/explorer/testnet/tx/3ec506bcffa7f52e48baa5c0c322a0b531ea214816369aa38adc21e474402971) (ledger 5872624) |
| 6 | set_threshold 2 | owner | ok | [`3e78b4e9…6adaee`](https://stellar.expert/explorer/testnet/tx/3e78b4e956ab2c54a5a799aafb049f756a13020636f6843a9558f06bb26adaee) (ledger 5872625) |
| 7 | submit_milestone_proof milestone-1 | submitter | ok | [`c9ceac14…bec8be`](https://stellar.expert/explorer/testnet/tx/c9ceac1497568e84d2bc89d6c4c0295d5dc8dad09e6624e0babb2c7a61bec8be) (ledger 5872626) |
| 8 | submit_milestone_proof milestone-1 by a non-member | outsider | refused: `NotMember` (#7) | [`861331ac…839ac7`](https://stellar.expert/explorer/testnet/tx/861331acc5a9823895da7c3504cc0072e5a13ba4ea36227b09ffb59be6839ac7) (ledger 5872627), failed as expected |
| 9 | approve_milestone milestone-1 | approver1 | ok | [`87727b4e…d325c1`](https://stellar.expert/explorer/testnet/tx/87727b4ea29b5dd4f1224f83a63c607629934ebd7ac7aa3ddd2e58c073d325c1) (ledger 5872628) |
| 10 | approve_milestone milestone-1 a second time | approver1 | refused: `AlreadyApproved` (#8) | [`caf98956…f758a7`](https://stellar.expert/explorer/testnet/tx/caf989565aad62f0773c25f9f1aecc3e2678bedb632ae604397a09fe9ff758a7) (ledger 5872629), failed as expected |
| 11 | approve_milestone milestone-1 | approver2 | ok | [`4b328ac8…7d79df`](https://stellar.expert/explorer/testnet/tx/4b328ac8dcb40299df82e577d16f72710ab71db828cdd689af42a66bd87d79df) (ledger 5872630) |
| 12 | get_milestone_status milestone-1 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 13 | submit_milestone_proof milestone-2 | submitter | ok | [`59f8cf23…9524e1`](https://stellar.expert/explorer/testnet/tx/59f8cf23df8ddc5e6becf51242da47f5c2946c69b6be320266b6c9ef709524e1) (ledger 5872631) |
| 14 | approve_milestone milestone-2 | approver1 | ok | [`1dcfafad…a21aad`](https://stellar.expert/explorer/testnet/tx/1dcfafad6a648e3fece4a5c204f29949861c423ef3f12baf8dce7dcdd8a21aad) (ledger 5872632) |
| 15 | approve_milestone milestone-2 | approver2 | ok | [`2aa290fa…be1edc`](https://stellar.expert/explorer/testnet/tx/2aa290fa7fca88af50d14525a0a71e9942c960bc83186a4174228a4863be1edc) (ledger 5872633) |
| 16 | get_milestone_status milestone-2 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 17 | submit_milestone_proof milestone-3 | submitter | ok | [`b6301937…d6b915`](https://stellar.expert/explorer/testnet/tx/b63019373c60ac7d09d8d83021376e6a9c6d6dfbaba7bfa4bee9920136d6b915) (ledger 5872634) |
| 18 | approve_milestone milestone-3 | approver1 | ok | [`49822ab6…5e3859`](https://stellar.expert/explorer/testnet/tx/49822ab61092228fbfeb6598810043dd72b69a02901d08c7796039e9745e3859) (ledger 5872635) |
| 19 | approve_milestone milestone-3 | approver2 | ok | [`39c9d628…20bac5`](https://stellar.expert/explorer/testnet/tx/39c9d62830ab2e2148650aad0b243adf0aa2079912cd9e7f2d54e336f020bac5) (ledger 5872636) |
| 20 | get_milestone_status milestone-3 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 21 | submit_milestone_proof milestone-4 | submitter | ok | [`770da6b2…5703b2`](https://stellar.expert/explorer/testnet/tx/770da6b27d23c53cc7b8fa0847414e9250c472eab2931f3e21a5f33bb35703b2) (ledger 5872637) |
| 22 | approve_milestone milestone-4 | approver1 | ok | [`db70181e…223213`](https://stellar.expert/explorer/testnet/tx/db70181ebb6472a319b6cbbe40ae4dc92030a36f1abb0a383d07a597c9223213) (ledger 5872638) |
| 23 | approve_milestone milestone-4 | approver2 | ok | [`528af6a2…2260b3`](https://stellar.expert/explorer/testnet/tx/528af6a2e28f1c57429ce5d38173eddb3a19b7bc2db20e672220016d482260b3) (ledger 5872639) |
| 24 | get_milestone_status milestone-4 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 25 | submit_milestone_proof milestone-5 | submitter | ok | [`49f6489e…05c050`](https://stellar.expert/explorer/testnet/tx/49f6489e3fea07cc6698276533fed37a7ff9c7bac4fe6c5d43ce27d66505c050) (ledger 5872640) |
| 26 | approve_milestone milestone-5 | approver1 | ok | [`b40e2174…c17807`](https://stellar.expert/explorer/testnet/tx/b40e217457b293ffa08318bbd29b66a07d9db95fd3db897c5f4f7bd343c17807) (ledger 5872641) |
| 27 | approve_milestone milestone-5 | approver2 | ok | [`ab2a1c0b…a41161`](https://stellar.expert/explorer/testnet/tx/ab2a1c0be8661a53fd55b822d5d08ddb27c4c4d2d8da3c36f5fecd1ef0a41161) (ledger 5872642) |
| 28 | get_milestone_status milestone-5 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 29 | remove_member approver3 | owner | ok | [`997e8fb3…dbe1a7`](https://stellar.expert/explorer/testnet/tx/997e8fb32c2d4e2e688adc97d4ba49ee4a26692c3c8e1df388b89a6180dbe1a7) (ledger 5872643) |
| 30 | submit_milestone_proof milestone-6 | submitter | ok | [`ea69925c…197eda`](https://stellar.expert/explorer/testnet/tx/ea69925c5d2436365a8c7c6ce1cfa8896e6856a860edc74f81d1975861197eda) (ledger 5872644) |
| 31 | approve_milestone milestone-6 by the removed approver | approver3 | refused: `NotMember` (#7) | [`bf50ee71…5992fc`](https://stellar.expert/explorer/testnet/tx/bf50ee71789182215293af8a3dfe8cee9f155144278a312f37b825c43e5992fc) (ledger 5872645), failed as expected |
| 32 | approve_milestone milestone-6 | approver1 | ok | [`b5463132…b8973f`](https://stellar.expert/explorer/testnet/tx/b5463132f2aee62590fcaaee8ce199542558f94a7ccbf343ca07d559cfb8973f) (ledger 5872646) |
| 33 | approve_milestone milestone-6 | approver2 | ok | [`a9f3c4bf…12a843`](https://stellar.expert/explorer/testnet/tx/a9f3c4bfab62008f30e8c9957fb0eb1cf19a32705e10d8b89131b8380712a843) (ledger 5872647) |
| 34 | get_milestone_status milestone-6 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 35 | anchor_batch approved, 6 leaves | submitter | root 1953fe24b8076304… | [`20821c82…aca7a2`](https://stellar.expert/explorer/testnet/tx/20821c82433758bf3a546e6d359263b89eef49823f2a77c98aad96d1d9aca7a2) (ledger 5872648) |
| 36 | get_batch approved | anyone | 6 leaves, stored root matches the local tree | simulated |
| 37 | anchor_batch records, 128 leaves | submitter | root 933cc5f95807a1bb… | [`c57d2544…2e0742`](https://stellar.expert/explorer/testnet/tx/c57d2544553fdec10bbb0f9bf967ea2c031ff7c3bac81c2088c62498162e0742) (ledger 5872649) |
| 38 | get_batch records | anyone | 128 leaves, stored root matches the local tree | simulated |

| Approved milestone | Version | Approvers | `verifyMilestone` |
| --- | ---: | ---: | --- |
| milestone-1 | 1 | 2 | ok |
| milestone-2 | 1 | 2 | ok |
| milestone-3 | 1 | 2 | ok |
| milestone-4 | 1 | 2 | ok |
| milestone-5 | 1 | 2 | ok |
| milestone-6 | 1 | 2 | ok |

| Batch | Leaves | Root | Anchor | Proofs verified |
| --- | ---: | --- | --- | --- |
| approved | 6 | `1953fe24b8076304…` | [`20821c82…aca7a2`](https://stellar.expert/explorer/testnet/tx/20821c82433758bf3a546e6d359263b89eef49823f2a77c98aad96d1d9aca7a2) (ledger 5872648) | 6 of 6 |
| records | 128 | `933cc5f95807a1bb…` | [`c57d2544…2e0742`](https://stellar.expert/explorer/testnet/tx/c57d2544553fdec10bbb0f9bf967ea2c031ff7c3bac81c2088c62498162e0742) (ledger 5872649) | 128 of 128 |

## qa-2: 2 of 3 approvers

Project id `ec95a20c-356e-4e3f-b6d4-3a9fd4c0b7de`.

| Role | Account |
| --- | --- |
| owner | [`GDU3OUPL…QZWISO`](https://stellar.expert/explorer/testnet/account/GDU3OUPLDVQHDUMDFTMXSY4KV5647RVWDUKKRPODMG4MZVS6HMQZWISO) |
| submitter | [`GDARASIP…EUTVXH`](https://stellar.expert/explorer/testnet/account/GDARASIPOPOEAZV3HZSHJK3U5SJJWNWEI5W4LYL2HTVFVHYTWAEUTVXH) |
| approver1 | [`GACUOREM…XNAZSR`](https://stellar.expert/explorer/testnet/account/GACUOREMP2MY3J46JLUPSD7OT5BZO6KATBDWVAFZJRKU6VVAKIXNAZSR) |
| approver2 | [`GDVI7XWK…NJN4XE`](https://stellar.expert/explorer/testnet/account/GDVI7XWKS4M6ODDQAMMBAULNBOVHEJ5U44NEBJZKTZNW3IWU3ZNJN4XE) |
| approver3 | [`GAVNL5BD…RBFWCI`](https://stellar.expert/explorer/testnet/account/GAVNL5BDUGV5ZULQNHUXJYHXD2SGQQQAY75EQYMQ2KCICLTR4KRBFWCI) |

| # | Step | Signer | Outcome | Transaction |
| ---: | --- | --- | --- | --- |
| 1 | create_project, threshold 1 | owner | ok | [`6e719692…11f3b3`](https://stellar.expert/explorer/testnet/tx/6e7196926408c5d8b300e14ab496e81f0763ba68c2cf843739e13cc1fb11f3b3) (ledger 5872619) |
| 2 | add_member approver1 as Approver | owner | ok | [`7aea4010…248ff3`](https://stellar.expert/explorer/testnet/tx/7aea401068d0fa6e29d9851bef58f921b857532d7e53e0a5162dd92d7b248ff3) (ledger 5872620) |
| 3 | add_member approver2 as Approver | owner | ok | [`b67ea218…d420fd`](https://stellar.expert/explorer/testnet/tx/b67ea218f846960fd8a8f7e8d225f57a7114b29350aa4d952d7b12a958d420fd) (ledger 5872621) |
| 4 | add_member approver3 as Approver | owner | ok | [`5529f774…9460e0`](https://stellar.expert/explorer/testnet/tx/5529f7749828d67f6ff51ed2796bab045b9cd23b955ec5e354d39bc1529460e0) (ledger 5872622) |
| 5 | add_member submitter as Submitter | owner | ok | [`9638ca67…b830fd`](https://stellar.expert/explorer/testnet/tx/9638ca6772564bb61466f811070082817fe3866a6e0d17865c9e1eed26b830fd) (ledger 5872623) |
| 6 | set_threshold 2 | owner | ok | [`6e1c86d1…878bed`](https://stellar.expert/explorer/testnet/tx/6e1c86d1ca5bb2c773c9577c383bd184b1fe950c435896e508ab690c1c878bed) (ledger 5872624) |
| 7 | submit_milestone_proof milestone-1 | submitter | ok | [`cbf313b8…7ffc96`](https://stellar.expert/explorer/testnet/tx/cbf313b8d384bd5a9d50c92794e7e947fa3e5af4735befb352d5079df27ffc96) (ledger 5872625) |
| 8 | approve_milestone milestone-1 | approver1 | ok | [`0c460b33…330d36`](https://stellar.expert/explorer/testnet/tx/0c460b33fea12903cb4b266ba0abb9b7c8c8b84b0e691579dde2769ee2330d36) (ledger 5872626) |
| 9 | approve_milestone milestone-1 | approver2 | ok | [`af63c568…781046`](https://stellar.expert/explorer/testnet/tx/af63c568e119d95ae7f700a5fa4a9b2db2986ee17c3446168a84628cea781046) (ledger 5872627) |
| 10 | get_milestone_status milestone-1 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 11 | submit_milestone_proof milestone-2 | submitter | ok | [`85eaa135…bb71c5`](https://stellar.expert/explorer/testnet/tx/85eaa135e26b97720d4d189f1d4688d8f19d01a581eef2e92e72058722bb71c5) (ledger 5872628) |
| 12 | approve_milestone milestone-2 | approver1 | ok | [`542889dd…8e8580`](https://stellar.expert/explorer/testnet/tx/542889dd411eb09af9bf4da753d9d1c1a4b79868bc8bc4fb09647061818e8580) (ledger 5872629) |
| 13 | approve_milestone milestone-2 | approver2 | ok | [`4c1ac01a…592751`](https://stellar.expert/explorer/testnet/tx/4c1ac01a4379c5f318b1b64eb72dfa626e8cffda41833d8b02cd90222e592751) (ledger 5872630) |
| 14 | get_milestone_status milestone-2 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 15 | submit_milestone_proof milestone-3 | submitter | ok | [`dc6c0930…b8be7a`](https://stellar.expert/explorer/testnet/tx/dc6c0930815d4462245458b1107678a1e4e838cd14bf84226deb7857feb8be7a) (ledger 5872631) |
| 16 | approve_milestone milestone-3 | approver1 | ok | [`c7ce4814…7360e3`](https://stellar.expert/explorer/testnet/tx/c7ce4814f05aa40afee0b1353d34c77324876c574a5028fc2e86e8dee27360e3) (ledger 5872632) |
| 17 | approve_milestone milestone-3 | approver2 | ok | [`3a877d63…64c4df`](https://stellar.expert/explorer/testnet/tx/3a877d63b1a9099c2818e4dc345b11b39d0fb210604ce325533c0118b664c4df) (ledger 5872633) |
| 18 | get_milestone_status milestone-3 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 19 | submit_milestone_proof milestone-4 | submitter | ok | [`2006b4b6…815d58`](https://stellar.expert/explorer/testnet/tx/2006b4b6eb9789f40df0ed126682c6999a1c1f2e1071f978799c51a00a815d58) (ledger 5872634) |
| 20 | approve_milestone milestone-4 | approver1 | ok | [`337d6278…3c089f`](https://stellar.expert/explorer/testnet/tx/337d62789fd566f21f9aa1dd41487372304783d708342d6f1a79215f943c089f) (ledger 5872635) |
| 21 | approve_milestone milestone-4 | approver2 | ok | [`943e5d81…75318b`](https://stellar.expert/explorer/testnet/tx/943e5d8137d82a85caf6c8da3a5293d6b6c88f2523f79a06d0ecbabac875318b) (ledger 5872636) |
| 22 | get_milestone_status milestone-4 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 23 | submit_milestone_proof milestone-5 | submitter | ok | [`60c3eb98…d045ca`](https://stellar.expert/explorer/testnet/tx/60c3eb98cab2f8ada37c7130ab5dea41c904d3e978b738a00141557756d045ca) (ledger 5872637) |
| 24 | approve_milestone milestone-5 | approver1 | ok | [`793ad307…b1f4d7`](https://stellar.expert/explorer/testnet/tx/793ad307c8bba3cbd194aec6ecdd57df4320d26dd0885ffc32da7704e1b1f4d7) (ledger 5872638) |
| 25 | approve_milestone milestone-5 | approver2 | ok | [`1b1c62d5…604be9`](https://stellar.expert/explorer/testnet/tx/1b1c62d51bb872015a9401ebdef6b606b5af2babb1fcff7edf11bdc9ef604be9) (ledger 5872639) |
| 26 | get_milestone_status milestone-5 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 27 | submit_milestone_proof milestone-6 | submitter | ok | [`70ee802f…f27b68`](https://stellar.expert/explorer/testnet/tx/70ee802f8f6038be162d0f0825e323fa7c5e048457e3ebcf776877b6a0f27b68) (ledger 5872640) |
| 28 | approve_milestone milestone-6 | approver1 | ok | [`7abb481b…4dc0bd`](https://stellar.expert/explorer/testnet/tx/7abb481bb5b7201b6acdbcd06f25b211e929f29f95053e2554939847064dc0bd) (ledger 5872641) |
| 29 | reject_milestone milestone-6 | approver2 | ok | [`95ea630a…1685f2`](https://stellar.expert/explorer/testnet/tx/95ea630a81ff3f7e88ce16389efbe8ad8a160d8f121201719760406ea01685f2) (ledger 5872642) |
| 30 | get_milestone_status milestone-6 | anyone | status Rejected, version 1, 1 approval(s) | simulated |
| 31 | submit_milestone_proof milestone-6 again, revised proof | submitter | ok | [`71114e51…1ca2af`](https://stellar.expert/explorer/testnet/tx/71114e513e866f8b13cc07666afac7af6e11531e9f0426be67d4fb9bdc1ca2af) (ledger 5872643) |
| 32 | get_milestone_status milestone-6 | anyone | status Submitted, version 2, 0 approval(s) | simulated |
| 33 | approve_milestone milestone-6 | approver1 | ok | [`902dc9cd…2c3062`](https://stellar.expert/explorer/testnet/tx/902dc9cd4167e4114c02bce715601947c507e8c6b936bb378201c30a042c3062) (ledger 5872644) |
| 34 | approve_milestone milestone-6 | approver2 | ok | [`de81fb09…bbe545`](https://stellar.expert/explorer/testnet/tx/de81fb09260da6506f9f40b11982a8b65d4b7f042effa953b14f48079fbbe545) (ledger 5872645) |
| 35 | get_milestone_status milestone-6 | anyone | status Approved, version 2, 2 approval(s) | simulated |
| 36 | anchor_batch approved, 6 leaves | submitter | root da4dfad27d4629c5… | [`711bc846…635fab`](https://stellar.expert/explorer/testnet/tx/711bc846d168432047c9f389274933060c4acaefc8350df67516508d32635fab) (ledger 5872646) |
| 37 | get_batch approved | anyone | 6 leaves, stored root matches the local tree | simulated |
| 38 | anchor_batch records, 20 leaves | submitter | root 643aeda462759dc7… | [`aeb98cab…5321cb`](https://stellar.expert/explorer/testnet/tx/aeb98cab7a4722b42ddeeb57cd22cfc6eda58e57c32339a87e9b4ba6aa5321cb) (ledger 5872647) |
| 39 | get_batch records | anyone | 20 leaves, stored root matches the local tree | simulated |

| Approved milestone | Version | Approvers | `verifyMilestone` |
| --- | ---: | ---: | --- |
| milestone-1 | 1 | 2 | ok |
| milestone-2 | 1 | 2 | ok |
| milestone-3 | 1 | 2 | ok |
| milestone-4 | 1 | 2 | ok |
| milestone-5 | 1 | 2 | ok |
| milestone-6 | 2 | 2 | ok |

| Batch | Leaves | Root | Anchor | Proofs verified |
| --- | ---: | --- | --- | --- |
| approved | 6 | `da4dfad27d4629c5…` | [`711bc846…635fab`](https://stellar.expert/explorer/testnet/tx/711bc846d168432047c9f389274933060c4acaefc8350df67516508d32635fab) (ledger 5872646) | 6 of 6 |
| records | 20 | `643aeda462759dc7…` | [`aeb98cab…5321cb`](https://stellar.expert/explorer/testnet/tx/aeb98cab7a4722b42ddeeb57cd22cfc6eda58e57c32339a87e9b4ba6aa5321cb) (ledger 5872647) | 20 of 20 |

## qa-3: 2 of 3 approvers

Project id `e43e0a89-20a9-477a-ad17-6460d712f6fc`.

| Role | Account |
| --- | --- |
| owner | [`GA4XKOHH…XCPLAA`](https://stellar.expert/explorer/testnet/account/GA4XKOHHQKUPTLMYHDCDGHV5WBJF4HG3VSM3FVOBTQI2VZM2VCXCPLAA) |
| submitter | [`GBFHSOWU…JTO633`](https://stellar.expert/explorer/testnet/account/GBFHSOWUSAJWEFANWCGDOLQWKWV7M5Q7SWF6YTPNWPYZATAARRJTO633) |
| approver1 | [`GD2ZCXUI…3UV7EZ`](https://stellar.expert/explorer/testnet/account/GD2ZCXUIH65KKRNCXGO44BTE6WP6MB6Y56LJBKQNFAPAAYRYJB3UV7EZ) |
| approver2 | [`GALBK64W…BBQXV5`](https://stellar.expert/explorer/testnet/account/GALBK64WDGJ3FZ4ZQOR4MVCGIKF5VMFDJK45E5CGPKJHSA3WJ7BBQXV5) |
| approver3 | [`GAIKL43R…5K7CVO`](https://stellar.expert/explorer/testnet/account/GAIKL43R6USMGHAIRWDYCW2QR5QDU3EIIZPMAXYPQLWR73LXJP5K7CVO) |

| # | Step | Signer | Outcome | Transaction |
| ---: | --- | --- | --- | --- |
| 1 | create_project, threshold 1 | owner | ok | [`bbe1345c…842f09`](https://stellar.expert/explorer/testnet/tx/bbe1345c3798bbb4fdbf3e6bd42f3d0a7ede2c20522444a39b3f958c8a842f09) (ledger 5872620) |
| 2 | add_member approver1 as Approver | owner | ok | [`14b57983…ed24ce`](https://stellar.expert/explorer/testnet/tx/14b57983ad712c14a99c99512e363ba3d599f0390bac8c6d510ee7b02eed24ce) (ledger 5872621) |
| 3 | add_member approver2 as Approver | owner | ok | [`cd56ed94…62d35a`](https://stellar.expert/explorer/testnet/tx/cd56ed94d9699b9964b5c599e32ff79ab9fe8cd8aeda90ffe8aebe1a5662d35a) (ledger 5872622) |
| 4 | add_member approver3 as Approver | owner | ok | [`13ed8a07…ea457d`](https://stellar.expert/explorer/testnet/tx/13ed8a07d1603d18b219a23c3cdbf341be3f4883f9965c1e7aa446410fea457d) (ledger 5872623) |
| 5 | add_member submitter as Submitter | owner | ok | [`849762df…206e7f`](https://stellar.expert/explorer/testnet/tx/849762df5a5512857e8a331b656033912d30874f35c4cc999ee401ca74206e7f) (ledger 5872624) |
| 6 | set_threshold 2 | owner | ok | [`029364c0…957bd8`](https://stellar.expert/explorer/testnet/tx/029364c0b8951e00a151e05bd36fcf04814b2385e6871063939746c20e957bd8) (ledger 5872625) |
| 7 | submit_milestone_proof milestone-1 | submitter | ok | [`7241f29e…74ea4e`](https://stellar.expert/explorer/testnet/tx/7241f29eb190721b3cd25d1517cab256c603643edd07855ac026389f1e74ea4e) (ledger 5872626) |
| 8 | approve_milestone milestone-1 | approver1 | ok | [`207f08f0…71f280`](https://stellar.expert/explorer/testnet/tx/207f08f02a704c7490094b9093332e9de94d75dc7d7bb10f459443306271f280) (ledger 5872627) |
| 9 | approve_milestone milestone-1 | approver2 | ok | [`502b3e38…274e0b`](https://stellar.expert/explorer/testnet/tx/502b3e38c469f196727ae5687de8923790b82d3067981541c670b7cb1c274e0b) (ledger 5872628) |
| 10 | get_milestone_status milestone-1 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 11 | submit_milestone_proof milestone-2 | submitter | ok | [`d8b9aef0…27972f`](https://stellar.expert/explorer/testnet/tx/d8b9aef066be0561bc4f200e02b20a480d594b41a539ec4f75a9913cd727972f) (ledger 5872629) |
| 12 | approve_milestone milestone-2 | approver1 | ok | [`b042ace8…6352b6`](https://stellar.expert/explorer/testnet/tx/b042ace8760d0e076074fe43c9a1c4ccd8252322d785fe0db70b52e4126352b6) (ledger 5872630) |
| 13 | approve_milestone milestone-2 | approver2 | ok | [`6299cb4c…eef2b8`](https://stellar.expert/explorer/testnet/tx/6299cb4c65d8e4c7d5224e2977a1ca3c7de1c015f65015250c1d350fa4eef2b8) (ledger 5872631) |
| 14 | get_milestone_status milestone-2 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 15 | submit_milestone_proof milestone-3 | submitter | ok | [`67440c65…97e2c8`](https://stellar.expert/explorer/testnet/tx/67440c652e66bf8d2b5d358d6d382095cb1ac1f6bac0746fc5c11dd1d497e2c8) (ledger 5872632) |
| 16 | approve_milestone milestone-3 | approver1 | ok | [`dc26c52e…034961`](https://stellar.expert/explorer/testnet/tx/dc26c52eebc704c130f6e9a5b166e1a5464d358eb60c35e557037f232f034961) (ledger 5872633) |
| 17 | approve_milestone milestone-3 | approver2 | ok | [`5c55aa69…e18e2c`](https://stellar.expert/explorer/testnet/tx/5c55aa693a72ec896b95f23e3fed16acc4156679d02344f821a9c8ff3de18e2c) (ledger 5872634) |
| 18 | get_milestone_status milestone-3 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 19 | submit_milestone_proof milestone-4 | submitter | ok | [`db2d28f9…3d9cbe`](https://stellar.expert/explorer/testnet/tx/db2d28f9e48eba7bcaab2cb08fc9a4c090e92984c0a4b46a69e25e46dd3d9cbe) (ledger 5872635) |
| 20 | approve_milestone milestone-4 | approver1 | ok | [`ccf9064b…4667c1`](https://stellar.expert/explorer/testnet/tx/ccf9064bd59039def5153fb27cdc0275d8f32f2ac718ff6ed5d09885914667c1) (ledger 5872636) |
| 21 | approve_milestone milestone-4 | approver2 | ok | [`833ff47f…0b57ab`](https://stellar.expert/explorer/testnet/tx/833ff47ffbcdaecb577c8bd563d5d999d160a2bf933953d89080f54fa60b57ab) (ledger 5872637) |
| 22 | get_milestone_status milestone-4 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 23 | submit_milestone_proof milestone-5 | submitter | ok | [`ce2069ab…5bf11b`](https://stellar.expert/explorer/testnet/tx/ce2069ababd15f48d412395a1dcaa4abfb18d964a6eefe2cae7739f6305bf11b) (ledger 5872638) |
| 24 | approve_milestone milestone-5 | approver1 | ok | [`bdaf52a4…efe868`](https://stellar.expert/explorer/testnet/tx/bdaf52a40e629168c2499c66e7537b22ebfee8ae56334bd6a783c3c772efe868) (ledger 5872639) |
| 25 | approve_milestone milestone-5 | approver2 | ok | [`25cfa7ea…05042a`](https://stellar.expert/explorer/testnet/tx/25cfa7eaea9c97034d9189fdc31c0642502c033d477f3af6bc3d6b5e4405042a) (ledger 5872640) |
| 26 | get_milestone_status milestone-5 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 27 | anchor_batch approved, 5 leaves | submitter | root 8f5be5cff714fd8d… | [`7163ebee…51ee2b`](https://stellar.expert/explorer/testnet/tx/7163ebeee5d88c92459e8c53b8e96b694444966ba82dcf1be302502f5b51ee2b) (ledger 5872641) |
| 28 | get_batch approved | anyone | 5 leaves, stored root matches the local tree | simulated |
| 29 | anchor_batch records, 20 leaves | submitter | root 023a9a6046454bc2… | [`ae372b91…0fbcf8`](https://stellar.expert/explorer/testnet/tx/ae372b91617fc5e8d1ebea776d6afe5b501ec43d8ff4f70c4bb07dfbc40fbcf8) (ledger 5872642) |
| 30 | get_batch records | anyone | 20 leaves, stored root matches the local tree | simulated |

| Approved milestone | Version | Approvers | `verifyMilestone` |
| --- | ---: | ---: | --- |
| milestone-1 | 1 | 2 | ok |
| milestone-2 | 1 | 2 | ok |
| milestone-3 | 1 | 2 | ok |
| milestone-4 | 1 | 2 | ok |
| milestone-5 | 1 | 2 | ok |

| Batch | Leaves | Root | Anchor | Proofs verified |
| --- | ---: | --- | --- | --- |
| approved | 5 | `8f5be5cff714fd8d…` | [`7163ebee…51ee2b`](https://stellar.expert/explorer/testnet/tx/7163ebeee5d88c92459e8c53b8e96b694444966ba82dcf1be302502f5b51ee2b) (ledger 5872641) | 5 of 5 |
| records | 20 | `023a9a6046454bc2…` | [`ae372b91…0fbcf8`](https://stellar.expert/explorer/testnet/tx/ae372b91617fc5e8d1ebea776d6afe5b501ec43d8ff4f70c4bb07dfbc40fbcf8) (ledger 5872642) | 20 of 20 |

## qa-4: 3 of 4 approvers

Project id `50891578-9540-46e7-9e85-56ec7dfde114`.

| Role | Account |
| --- | --- |
| owner | [`GBMTRBOT…MCRA7U`](https://stellar.expert/explorer/testnet/account/GBMTRBOTKO6NHG7AGIF4X4XW6T5XYI5IB4IALUI3ZPIWL4DYQWMCRA7U) |
| submitter | [`GBEP2AUQ…P5WEQV`](https://stellar.expert/explorer/testnet/account/GBEP2AUQBAPYIID7RUM5Z3EI7545UGVJRPX3RJHHNN72OCHKTRP5WEQV) |
| approver1 | [`GDEEJZPM…DPEV66`](https://stellar.expert/explorer/testnet/account/GDEEJZPMNBGGYO2D3IWLNF7NX2RPGFP4N547CTAN4NL2JDYMUWDPEV66) |
| approver2 | [`GDLWAGSB…IV4CXY`](https://stellar.expert/explorer/testnet/account/GDLWAGSB5PBCC2HECJ4QCINOFQLMIIQPLMBHKXWLYGZHG3KGXJIV4CXY) |
| approver3 | [`GAKCGTOW…MFSIHC`](https://stellar.expert/explorer/testnet/account/GAKCGTOWTY2WITTGOLXAPUBJEY24OZNEXCPWXY3XXOZEQHJGX6MFSIHC) |
| approver4 | [`GCJHQWGP…XVJUI2`](https://stellar.expert/explorer/testnet/account/GCJHQWGP6GTRSKHUOXM3O3QEXMEQGFK6C6HMJVOR45GMU5S4EJXVJUI2) |

| # | Step | Signer | Outcome | Transaction |
| ---: | --- | --- | --- | --- |
| 1 | create_project, threshold 1 | owner | ok | [`3f08952c…fd096d`](https://stellar.expert/explorer/testnet/tx/3f08952cdb0c190736007d12731a5a1ef4e852a1f635cad26edab82ea4fd096d) (ledger 5872620) |
| 2 | add_member approver1 as Approver | owner | ok | [`0a922a71…038293`](https://stellar.expert/explorer/testnet/tx/0a922a715118cc905efae628da0aa4f7547a5e0b8f31c376ee22980043038293) (ledger 5872621) |
| 3 | add_member approver2 as Approver | owner | ok | [`12d63689…5d7367`](https://stellar.expert/explorer/testnet/tx/12d636899ffc34badb94a550972fdcf3fe8660f14f9548876ef97636515d7367) (ledger 5872622) |
| 4 | add_member approver3 as Approver | owner | ok | [`9a345faf…38b86d`](https://stellar.expert/explorer/testnet/tx/9a345faf5584f19bd3992bb6a0ac328198e1f5fcb2e3a29a014129195938b86d) (ledger 5872623) |
| 5 | add_member approver4 as Approver | owner | ok | [`f0b7d72d…f07fbe`](https://stellar.expert/explorer/testnet/tx/f0b7d72df6879060a99b520a0c718232e21738201972cab1a5ce22c070f07fbe) (ledger 5872624) |
| 6 | add_member submitter as Submitter | owner | ok | [`70a40ed5…32a196`](https://stellar.expert/explorer/testnet/tx/70a40ed549bafa68459f0ea19c99183395cd37ed83317781d5da35aa8732a196) (ledger 5872625) |
| 7 | set_threshold 3 | owner | ok | [`d0b8523c…e66a6d`](https://stellar.expert/explorer/testnet/tx/d0b8523ce4839dc8c9db5e0809041613fbeb60c34556eb6a972db9affee66a6d) (ledger 5872626) |
| 8 | submit_milestone_proof milestone-1 | submitter | ok | [`212021ca…467812`](https://stellar.expert/explorer/testnet/tx/212021caf70f05bedc612a959ff9689521074d78880d570f7ea272f4df467812) (ledger 5872627) |
| 9 | approve_milestone milestone-1 | approver1 | ok | [`066a6a3f…9f94b7`](https://stellar.expert/explorer/testnet/tx/066a6a3fbf44ce744619bc2aa564ba4cfaeb20d592fee441af92ccd4749f94b7) (ledger 5872628) |
| 10 | approve_milestone milestone-1 | approver2 | ok | [`d5b2ade9…8c28a1`](https://stellar.expert/explorer/testnet/tx/d5b2ade90bb82d5c81aa86a5ace918271c6d5863d3a9cdef76f1e9b68f8c28a1) (ledger 5872629) |
| 11 | approve_milestone milestone-1 | approver3 | ok | [`21fd68c8…71560d`](https://stellar.expert/explorer/testnet/tx/21fd68c8ad542a1b2a47b7c58d37873a22984802937fdb7604f584522371560d) (ledger 5872630) |
| 12 | get_milestone_status milestone-1 | anyone | status Approved, version 1, 3 approval(s) | simulated |
| 13 | submit_milestone_proof milestone-2 | submitter | ok | [`561f238e…344c5a`](https://stellar.expert/explorer/testnet/tx/561f238e6e2dfdc70543f8a4e34da5e8e5ce6acb13ad7fef61dd424c63344c5a) (ledger 5872631) |
| 14 | approve_milestone milestone-2 | approver1 | ok | [`f520b1d7…2a7b6a`](https://stellar.expert/explorer/testnet/tx/f520b1d781ecacfde785a24b9aef80c6bf85aed9fc8618c4022d4693a42a7b6a) (ledger 5872632) |
| 15 | approve_milestone milestone-2 | approver2 | ok | [`042ed95c…6fe5e1`](https://stellar.expert/explorer/testnet/tx/042ed95cf7fa5848ca259c03a30b3eb92ddbc857450dc018e976e419e26fe5e1) (ledger 5872633) |
| 16 | approve_milestone milestone-2 | approver3 | ok | [`170063be…2e143a`](https://stellar.expert/explorer/testnet/tx/170063beb833d184ee0fffc2f48f28fc4e95301ccbc87d4b26de524e112e143a) (ledger 5872634) |
| 17 | get_milestone_status milestone-2 | anyone | status Approved, version 1, 3 approval(s) | simulated |
| 18 | submit_milestone_proof milestone-3 | submitter | ok | [`2b9da26d…1905c1`](https://stellar.expert/explorer/testnet/tx/2b9da26d6b4e9443547adc05b298a1be505c778b3bfc181124747419081905c1) (ledger 5872635) |
| 19 | approve_milestone milestone-3 | approver1 | ok | [`8bfe1852…a5a274`](https://stellar.expert/explorer/testnet/tx/8bfe18529fb5980fa8a879b0bb31b65169f96b823eca24f3506abd8e4ea5a274) (ledger 5872636) |
| 20 | approve_milestone milestone-3 | approver2 | ok | [`676cc255…e0edb1`](https://stellar.expert/explorer/testnet/tx/676cc255b548e79ed394d8ea0192084d08f9e2ab44a5b3311d60dde863e0edb1) (ledger 5872637) |
| 21 | approve_milestone milestone-3 | approver3 | ok | [`6d8eb9b2…ca39c7`](https://stellar.expert/explorer/testnet/tx/6d8eb9b2aedd87dbb2d2c391e27726865353ced706ed1b31484e7d17b0ca39c7) (ledger 5872638) |
| 22 | get_milestone_status milestone-3 | anyone | status Approved, version 1, 3 approval(s) | simulated |
| 23 | submit_milestone_proof milestone-4 | submitter | ok | [`f5ea039d…56d42d`](https://stellar.expert/explorer/testnet/tx/f5ea039d9ab0b814a7aa2f2dd04557a3a44b93619e3d47f6b2b8d529bb56d42d) (ledger 5872639) |
| 24 | approve_milestone milestone-4 | approver1 | ok | [`3591e9b9…44f61e`](https://stellar.expert/explorer/testnet/tx/3591e9b9b917474bb4dd09c3744c58564e44044adcf8c5fc5020dde6ff44f61e) (ledger 5872640) |
| 25 | approve_milestone milestone-4 | approver2 | ok | [`c4f1c95c…6cb15f`](https://stellar.expert/explorer/testnet/tx/c4f1c95c804a79692c14d6aa7152526bdea2bc912b9e4c8700c9f391a96cb15f) (ledger 5872641) |
| 26 | approve_milestone milestone-4 | approver3 | ok | [`90c21d72…e2fc1a`](https://stellar.expert/explorer/testnet/tx/90c21d72a456a663146ad9040aab6c08e541ce1341de21cd60d2983309e2fc1a) (ledger 5872642) |
| 27 | get_milestone_status milestone-4 | anyone | status Approved, version 1, 3 approval(s) | simulated |
| 28 | submit_milestone_proof milestone-5 | submitter | ok | [`9f1dcf0a…67e487`](https://stellar.expert/explorer/testnet/tx/9f1dcf0ad7d461cb38e1f969d7bc87f6fb6e1b6ad00dc348db479c9ccd67e487) (ledger 5872643) |
| 29 | approve_milestone milestone-5 | approver1 | ok | [`a18f1cb4…bcf1c4`](https://stellar.expert/explorer/testnet/tx/a18f1cb4b806c17da790be1f6cb6844c42f52882ba285c29052e716afcbcf1c4) (ledger 5872644) |
| 30 | approve_milestone milestone-5 | approver2 | ok | [`6aba0c31…085619`](https://stellar.expert/explorer/testnet/tx/6aba0c31998895c64a3107008a12c53c8a96e0323daf625f79880d8e62085619) (ledger 5872645) |
| 31 | approve_milestone milestone-5 | approver3 | ok | [`1b6fe9d4…90ac00`](https://stellar.expert/explorer/testnet/tx/1b6fe9d462979cc0adb95fc55aa2186a1dcc493a3b62097726a483205290ac00) (ledger 5872646) |
| 32 | get_milestone_status milestone-5 | anyone | status Approved, version 1, 3 approval(s) | simulated |
| 33 | anchor_batch approved, 5 leaves | submitter | root 4fee430184bff0c3… | [`7ad3f353…b60b66`](https://stellar.expert/explorer/testnet/tx/7ad3f353eb34701707df2284cd1265c0872616d5bf7e02ecc6f1e039adb60b66) (ledger 5872648) |
| 34 | get_batch approved | anyone | 5 leaves, stored root matches the local tree | simulated |
| 35 | anchor_batch records, 20 leaves | submitter | root 5f4fd29f99888d59… | [`ef92025e…7ea993`](https://stellar.expert/explorer/testnet/tx/ef92025eaf942225b0ba3df9fc60c5829711258333d7148de83177fed97ea993) (ledger 5872649) |
| 36 | get_batch records | anyone | 20 leaves, stored root matches the local tree | simulated |

| Approved milestone | Version | Approvers | `verifyMilestone` |
| --- | ---: | ---: | --- |
| milestone-1 | 1 | 3 | ok |
| milestone-2 | 1 | 3 | ok |
| milestone-3 | 1 | 3 | ok |
| milestone-4 | 1 | 3 | ok |
| milestone-5 | 1 | 3 | ok |

| Batch | Leaves | Root | Anchor | Proofs verified |
| --- | ---: | --- | --- | --- |
| approved | 5 | `4fee430184bff0c3…` | [`7ad3f353…b60b66`](https://stellar.expert/explorer/testnet/tx/7ad3f353eb34701707df2284cd1265c0872616d5bf7e02ecc6f1e039adb60b66) (ledger 5872648) | 5 of 5 |
| records | 20 | `5f4fd29f99888d59…` | [`ef92025e…7ea993`](https://stellar.expert/explorer/testnet/tx/ef92025eaf942225b0ba3df9fc60c5829711258333d7148de83177fed97ea993) (ledger 5872649) | 20 of 20 |

## qa-5: 2 of 2 approvers

Project id `ad5718d9-a0be-497d-b699-3c4947972a9d`.

| Role | Account |
| --- | --- |
| owner | [`GBDWT2L5…T7AE45`](https://stellar.expert/explorer/testnet/account/GBDWT2L54OPDFXZBFQKGLKMAUT2DWTAS265KB7XYWHGIKRZQJQT7AE45) |
| submitter | [`GBWO4UMD…OKRGYD`](https://stellar.expert/explorer/testnet/account/GBWO4UMDORSQRUWXLJW6WTAMOPUCAVGHY3TBYBOI4DLYOG7XPIOKRGYD) |
| approver1 | [`GC2LUVA2…MLEVNC`](https://stellar.expert/explorer/testnet/account/GC2LUVA2Z7PDLUVBX2QESM7QW3EZTUG27VLANYFWCJA64JDZOPMLEVNC) |
| approver2 | [`GBLYRZZL…ACNJCS`](https://stellar.expert/explorer/testnet/account/GBLYRZZLKNSK4T3XC6WVPLBHSXQKPSKMU4IVUB6XLWH5VKEJPCACNJCS) |

| # | Step | Signer | Outcome | Transaction |
| ---: | --- | --- | --- | --- |
| 1 | create_project, threshold 1 | owner | ok | [`df4ee93d…9cf2f1`](https://stellar.expert/explorer/testnet/tx/df4ee93d50fe9ea26ac23b168223e90dbbe9f130189dc4f779031547669cf2f1) (ledger 5872618) |
| 2 | add_member approver1 as Approver | owner | ok | [`0f24c653…036e4f`](https://stellar.expert/explorer/testnet/tx/0f24c653d57cc2059c14a05cd068ed520a1d218e0f368459146cf2e7b8036e4f) (ledger 5872619) |
| 3 | add_member approver2 as Approver | owner | ok | [`57a5b4c0…e6e2d3`](https://stellar.expert/explorer/testnet/tx/57a5b4c0279e3a81770daed4c3ceaf41c1e26e0c46b1ca6d2e6136d3e2e6e2d3) (ledger 5872620) |
| 4 | add_member submitter as Submitter | owner | ok | [`54f10b92…4c585c`](https://stellar.expert/explorer/testnet/tx/54f10b9245b83b65e5b99a48117260184e6a7a5028629ddba6752bc5364c585c) (ledger 5872621) |
| 5 | set_threshold 2 | owner | ok | [`e66e0ca6…d7e876`](https://stellar.expert/explorer/testnet/tx/e66e0ca659d61a72edced0f99ee5aad8e5b54b28cdcbf27002f1dad94bd7e876) (ledger 5872622) |
| 6 | submit_milestone_proof milestone-1 | submitter | ok | [`9e404cf1…6abeb7`](https://stellar.expert/explorer/testnet/tx/9e404cf10ec8884e824dcc10e0500572de22c9f15cda6872813f14d8206abeb7) (ledger 5872623) |
| 7 | approve_milestone milestone-1 | approver1 | ok | [`abc829a6…2549c1`](https://stellar.expert/explorer/testnet/tx/abc829a67e77972644378f32c18dfe9f9f0e14a062555e41010a4bbd142549c1) (ledger 5872624) |
| 8 | approve_milestone milestone-1 | approver2 | ok | [`55618e62…ef1bae`](https://stellar.expert/explorer/testnet/tx/55618e62e2406facd3b5d5275597df356e9a2afdbd8ca0e38642169a47ef1bae) (ledger 5872625) |
| 9 | get_milestone_status milestone-1 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 10 | submit_milestone_proof milestone-2 | submitter | ok | [`7136546d…7d9c67`](https://stellar.expert/explorer/testnet/tx/7136546dc225855a6fabba9208d0fe96e650aecf3cadd70a27c844d60f7d9c67) (ledger 5872626) |
| 11 | approve_milestone milestone-2 | approver1 | ok | [`c2673e67…b3bc85`](https://stellar.expert/explorer/testnet/tx/c2673e6714e0eb369e846072861499c6e20268b71a179e42df1e20b72db3bc85) (ledger 5872627) |
| 12 | approve_milestone milestone-2 | approver2 | ok | [`c734bde0…af6919`](https://stellar.expert/explorer/testnet/tx/c734bde01dd28d25402afc98348b6d0f2a16240c06238bb1bec814376aaf6919) (ledger 5872628) |
| 13 | get_milestone_status milestone-2 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 14 | submit_milestone_proof milestone-3 | submitter | ok | [`84ab7b47…43e010`](https://stellar.expert/explorer/testnet/tx/84ab7b47f7da216dbd93543bed5c4408506b63821047022ffed3501bc143e010) (ledger 5872629) |
| 15 | approve_milestone milestone-3 | approver1 | ok | [`4ecfaa53…223196`](https://stellar.expert/explorer/testnet/tx/4ecfaa531f62fc7f30ca70956ad269f4add4656e6644b00c0781f14db5223196) (ledger 5872630) |
| 16 | approve_milestone milestone-3 | approver2 | ok | [`37d04412…836f48`](https://stellar.expert/explorer/testnet/tx/37d04412f1bcd8dd990738c2752d005fb868c8532b0affbbeae670d686836f48) (ledger 5872631) |
| 17 | get_milestone_status milestone-3 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 18 | submit_milestone_proof milestone-4 | submitter | ok | [`f287fbed…7d2208`](https://stellar.expert/explorer/testnet/tx/f287fbedda2f48306195cf57ea1831bcfede8d57bd6034736a50245f587d2208) (ledger 5872632) |
| 19 | approve_milestone milestone-4 | approver1 | ok | [`1c9c49d3…5cc539`](https://stellar.expert/explorer/testnet/tx/1c9c49d3f9119f32cff166c6db869fb06b3f6938563ed3662eb76c39a45cc539) (ledger 5872633) |
| 20 | approve_milestone milestone-4 | approver2 | ok | [`ee5d7df8…b57d1b`](https://stellar.expert/explorer/testnet/tx/ee5d7df8e38c9553269017b408def9c98f2e4debe678218c487c39fdfcb57d1b) (ledger 5872634) |
| 21 | get_milestone_status milestone-4 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 22 | submit_milestone_proof milestone-5 | submitter | ok | [`5999a253…3be1b6`](https://stellar.expert/explorer/testnet/tx/5999a2539b4c8099c60f0ecd6653c735bd14ad685b701587c0aaed422d3be1b6) (ledger 5872635) |
| 23 | approve_milestone milestone-5 | approver1 | ok | [`911a5a4c…a9f63e`](https://stellar.expert/explorer/testnet/tx/911a5a4c21cba5db9e87633d7d78baf1f7616c4c80fa62ed8db867bfbda9f63e) (ledger 5872636) |
| 24 | approve_milestone milestone-5 | approver2 | ok | [`76c198b4…ecf1e2`](https://stellar.expert/explorer/testnet/tx/76c198b4d7b8c018c4859b0543f364af1ec5912ad61df82027dfcab6acecf1e2) (ledger 5872637) |
| 25 | get_milestone_status milestone-5 | anyone | status Approved, version 1, 2 approval(s) | simulated |
| 26 | anchor_batch approved, 5 leaves | submitter | root 1d2752d899fe533b… | [`0469698f…444d44`](https://stellar.expert/explorer/testnet/tx/0469698f7e9be5a6def108376de55cf26f547925d467e5c863d1dc3b91444d44) (ledger 5872638) |
| 27 | get_batch approved | anyone | 5 leaves, stored root matches the local tree | simulated |
| 28 | anchor_batch records, 20 leaves | submitter | root fd7b9699ceb0451a… | [`db8ad241…586e72`](https://stellar.expert/explorer/testnet/tx/db8ad241952e4f27063101b9f76b298a30659656c40a9858a56ac62110586e72) (ledger 5872639) |
| 29 | get_batch records | anyone | 20 leaves, stored root matches the local tree | simulated |

| Approved milestone | Version | Approvers | `verifyMilestone` |
| --- | ---: | ---: | --- |
| milestone-1 | 1 | 2 | ok |
| milestone-2 | 1 | 2 | ok |
| milestone-3 | 1 | 2 | ok |
| milestone-4 | 1 | 2 | ok |
| milestone-5 | 1 | 2 | ok |

| Batch | Leaves | Root | Anchor | Proofs verified |
| --- | ---: | --- | --- | --- |
| approved | 5 | `1d2752d899fe533b…` | [`0469698f…444d44`](https://stellar.expert/explorer/testnet/tx/0469698f7e9be5a6def108376de55cf26f547925d467e5c863d1dc3b91444d44) (ledger 5872638) | 5 of 5 |
| records | 20 | `fd7b9699ceb0451a…` | [`db8ad241…586e72`](https://stellar.expert/explorer/testnet/tx/db8ad241952e4f27063101b9f76b298a30659656c40a9858a56ac62110586e72) (ledger 5872639) | 20 of 20 |
