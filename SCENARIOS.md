# Scenarios

## 1) Local smoke
```bash
npm run build
npm test
```

## 2) Local on-chain run
```bash
npm run test:onchain:local
npm run client:run:local
```

## 3) Full localnet journey tests
```bash
npm run client:test:localnet
npm run client:test:journey:localnet
```

## 4) GUI localnet play
```bash
npm run client:gui:localnet
```
Open `http://127.0.0.1:4178`.

## 5) Devnet preflight
```bash
npm run test:onchain:devnet
npm run client:run:devnet
```
