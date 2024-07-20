import { HttpProvider, MAINNET_API_NY_HTTP, signTx } from "@bloxroute/solana-trader-client-ts";
import fs from "fs";
import config from "./config";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import axios from "axios";


const RAYDIUM = new PublicKey(config.RAYDIUM_PUBLIC_KEY)
const HTTP_URL = config.HTTP_URL;
const WS_URL = config.WS_URL;

const connection = new Connection(HTTP_URL, {
    wsEndpoint: WS_URL
});

const provider = new HttpProvider(
    config.AUTH_HEADER,
    config.PRIVATE_KEY,
    MAINNET_API_NY_HTTP,
);

const wallet = config.PUBLIC_KEY;
const inAmount = 0.0001 * LAMPORTS_PER_SOL;
const slippage = 0.00005 * LAMPORTS_PER_SOL;
const solToken = "So11111111111111111111111111111111111111112";
const tip = "0.002";

interface Token {
    symbol: string;
    amount: number;
    price: number;
}

interface Portfolio {
    [symbol: string]: Token;
}

const PORTFOLIO_FILE = "portfolio.json";

let portfolio: Portfolio = {};

const savePortfolio = () => {
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
}

const loadPorfolio = () => {
    if (fs.existsSync(PORTFOLIO_FILE)) {
        const data = fs.readFileSync(PORTFOLIO_FILE, 'utf-8');
        portfolio = JSON.parse(data);
    } else {
        portfolio = {};
    }
}

const logTransaction = (transaction: any) => {
    fs.appendFileSync('transaction.log', JSON.stringify(transaction) + "\n");
}

const startMonitor = async () => {
    console.log('🤖 Monitoring log for programs:', RAYDIUM.toString());
    connection.onLogs(
        RAYDIUM,
        async ({logs, err, signature}) => {
            if (err) return;
            if (logs && logs.some(log => log.includes('initialize2'))) {
                console.log("✅ Signature for 'initialize2':", `https://explorer.solana.com/tx/${signature}`);
                const {tokenAAccount, tokenBAccount} = await fetchRaydiumMints(signature);
                await handleNewPool(tokenAAccount, tokenBAccount);
            }
        },
        'finalized'
    )
}

const fetchRaydiumMints = async (txId: string): Promise<{ tokenAAccount: PublicKey, tokenBAccount: PublicKey }> => {
    try {
        const tx = await connection.getParsedTransaction(
            txId,
            {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
            });

            if (!tx) throw new Error('❌ Transaction not found');

            //@ts-ignore
            const accounts = tx.transaction.message.instructions.find(ix => ix.programId.toBase58() === config.RAYDIUM_PUBLIC_KEY)?.accounts as PublicKey[];

            if (!accounts) throw new Error("❌ No accounts found in transaction");

            const tokenAAccount = accounts[8];
            const tokenBAccount = accounts[9];

            const displayData = [
                { "Token": "A", "Account Public Key": tokenAAccount.toBase58() },
                { "Token": "B", "Account Public Key": tokenBAccount.toBase58() }
            ];

            console.log("✅ New LP Found");
            console.table(displayData);

            return { tokenAAccount, tokenBAccount };
    } catch(error) {
        console.error('❌ Error fetching transaction:', txId, error);
        throw error;
    }
}

const fetchQuote = async (inToken: string, outToken: string, amount: number) => {
    try {
        const request = await provider.getRaydiumQuotes({
            inToken: inToken,
            outToken: outToken,
            inAmount: amount,
            slippage: slippage,
        });
        console.log("✅ Trade Quote Fetched:", request);
    } catch (error) {
        console.error("❌ Error occured while fetching quote", error);
    }
}

const buyOrder = async (symbol: string, amount: number) => {
    console.log("🤖 Placing buy order for token", symbol);
    
    if (symbol === solToken) {
        return null;
    } else {
        try {
            const order = await provider.submitTradeSwap({
                ownerAddress: wallet,
                inToken: solToken,
                outToken: symbol,
                inAmount: amount,
                slippage: slippage,
                project: "P_RAYDIUM",
                computeLimit: 1000,
                computePrice: "2000",
                // tip: tip
            }, "P_SUBMIT_ALL", true);

            for (const tx of order.transactions) {
                const signature = tx.signature;
                console.log(`✅ Buy Order placed successfully\nSignature: https://explorer.solana.com/tx/${signature}`);
            }

            logTransaction(order)

            return order;
        } catch (error) {
            console.error("❌ Error while occurred placing buy order:", error);
        }
    }
}

const sellOrder = async (symbol: string, amount: number) => {
    console.log("🤖 Placing sell order for token", symbol)

    if (symbol === symbol && symbol !== solToken ) {
        try {
            const order = await provider.submitTradeSwap({
                ownerAddress: wallet,
                inToken: symbol,
                outToken: solToken,
                inAmount: amount,
                slippage: slippage,
                project: "P_RAYDIUM",
                computeLimit: 1000,
                computePrice: "2000",
                // tip: tip
            }, "P_SUBMIT_ALL", true);

            for (const tx of order.transactions) {
                const signature = tx.signature;
                console.log(`✅ Sell Order placed successfully\nSignature: https://explorer.solana.com/tx/${signature}`);

                logTransaction(order);
            }
            return order;
        } catch (error) {
            console.error("❌ Error while occurred placing buy order:", error);
        }
    } else {
        return null;
    }
}

const fetchCurrentPrice = async (symbol: string): Promise<number> => {
    while (true) {
        try {
            const quote = await provider.getRaydiumQuotes({
                inToken: solToken,
                outToken: symbol,
                inAmount: inAmount,
                slippage: slippage,
            });
            const price = quote.routes[0].outAmount;
            return price;
        } catch(error) {
            console.error("❌ Error fetching current price");
            throw error;
        }
    }
}

// const fetchCurrentPrice = async (symbol: string): Promise<number> => {
//     const res = await provider.getRaydiumPrices({ tokens: [symbol] });
//     return res.tokenPrices
// }

const handleNewPool = async (tokenAAccount: PublicKey, tokenBAccount: PublicKey) => {
    const outToken = tokenAAccount.toBase58();
    const inToken = tokenBAccount.toBase58();

    if (!portfolio[outToken]) {
        await buyOrder(outToken, inAmount);
        portfolio[outToken] = { symbol: outToken, amount: inAmount, price: await fetchCurrentPrice(outToken) };
    }

    if (!portfolio[inToken]) {
        await buyOrder(inToken, inAmount);
        portfolio[inToken] = {symbol: inToken, amount: inAmount, price: await fetchCurrentPrice(outToken)};
    }

    // if (outToken === solToken) {
    //     return null;
    // } else {
    //     fetchQuote(inToken, outToken, inAmount);
    // }

    savePortfolio();
}

const monitorPortfolio = async () => {
    for (const symbol in portfolio) {
        const token = portfolio[symbol];
        const currentPrice = await fetchCurrentPrice(symbol);

        if (currentPrice >= 0.01 * LAMPORTS_PER_SOL) {
            const amountTosell = token.amount * 0.1;
            await sellOrder(symbol, amountTosell);
            token.amount -= amountTosell;
        }

        if (token.amount === 0) {
            delete portfolio[symbol];
        }
    }

    savePortfolio();
}

const startBot = async () => {
    loadPorfolio();
    setInterval(monitorPortfolio, 60000); // Check every 1 minute
    await startMonitor();
}

startBot().catch(console.error); 

