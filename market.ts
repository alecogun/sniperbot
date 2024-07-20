import config from "./config";
import { Connection, PublicKey } from "@solana/web3.js";

const RAYDIUM = new PublicKey(config.RAYDIUM_PUBLIC_KEY);
const HTTP_URL = config.HTTP_URL;
const WS_URL = config.WS_URL;
const INSTRUCTION_NAME = 'initialize2';

const connection = new Connection(HTTP_URL, {
    wsEndpoint: WS_URL
});

// Websocket connection
async function startConnection(connection: Connection, programAddress: PublicKey, searchInstruction: string, callback: (tokenAAccount: PublicKey, tokenBAccount: PublicKey) => void ): Promise<void> {
    console.log('Monitoring logs for programs:', programAddress.toString());
    connection.onLogs(
        programAddress,
        ({ logs, err, signature }) => {
            if (err) return;
            if (logs && logs.some(log => log.includes(searchInstruction))) {
                console.log("Signature for 'initialize2':", `https://explorer.solana.com/tx/${signature}`);
                fetchRaydiumMints(signature, connection, callback)
            }
        },
        "finalized"
    )
}

// Fetching Liquidity Pools Mints
async function fetchRaydiumMints(txId: string, connection: Connection, callback: (tokenAAccount: PublicKey, tokenBAccount: PublicKey) => void) {
    try {
        const tx = await connection.getParsedTransaction(
            txId,
            {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
            });

        //@ts-ignore
        const accounts = (tx?.transaction.message.instructions).find(ix => ix.programId.toBase58() === config.RAYDIUM_PUBLIC_KEY).accounts as PublicKey[];

        if (!accounts) {
            console.log('No account found in the transaction.');
            return;
        }

        const tokenAIndex = 8;
        const tokenBIndex = 9;

        const tokenAAccount = accounts[tokenAIndex];
        const tokenBAccount = accounts[tokenBIndex];

        const displayData = [
            { "Token": "A", "Account Public Key": tokenAAccount.toBase58() },
            { "Token": "B", "Account Public Key": tokenBAccount.toBase58() }
        ];

        console.log("New LP Found");
        console.table(displayData);

        callback(tokenAAccount, tokenBAccount)
    } catch {
        console.log("Error fetching transaction:", txId)
        return;
    }
}

export {startConnection, connection, RAYDIUM, INSTRUCTION_NAME }

async function monitorPools() {
    startConnection(connection, RAYDIUM, INSTRUCTION_NAME, (tokenAAccount) => {
        console.log('Token A Account Public Key:', tokenAAccount.toBase58())
    })
}

monitorPools().catch(console.error)

