#### Create merkle proof
- devnet
ts-node .\scripts\distributor.ts create -n sstar -e devnet -k ./service_wallet.json
 
- mainnet
ts-node .\scripts\distributor.ts create -n sstar -k <service wallet keypair path>

#### Create IDO 
- devnet
ts-node .\scripts\tool.ts create-ido -n sstar -e devnet --vault DiQqA4ctrxagNYLwDzv2MRhu28H8DpYHWQNxxSU8hCeM -k ./service_wallet.json

- mainnet
ts-node .\scripts\tool.ts create-ido -n sstar --vault <Service Wallet address> -k <service wallet keypair path>
