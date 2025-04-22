// File: netlify/functions/record-vote.js

// Import the Firebase Admin SDK
const admin = require('firebase-admin');

// --- Initialize Firebase Admin ---
// IMPORTANT: Uses Environment Variables set in Netlify later
try {
    if (!admin.apps.length) { // Check if already initialized
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), // Handle escaped newlines
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            }),
        });
    }
} catch (error) {
    console.error('Firebase admin initialization error:', error);
    // Return error immediately if init fails
    return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: 'Firebase initialization failed.' })
    };
}

const db = admin.firestore();

// --- Netlify Function Handler ---
exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Parse the incoming data
        const { destinationId, voterId } = JSON.parse(event.body);

        // Basic validation
        if (!destinationId || !voterId) {
            return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing destinationId or voterId' }) };
        }

        // References to Firestore documents
        const voteCountRef = db.collection('destinationVotes').doc(destinationId);
        const userVoteRef = db.collection('userVotes').doc(`${voterId}_${destinationId}`); // Unique ID for user+destination vote

        let alreadyVoted = false;
        let currentCount = 0;

        // Transaction to ensure atomic read/write
        await db.runTransaction(async (transaction) => {
            const userVoteDoc = await transaction.get(userVoteRef);
            const voteCountDoc = await transaction.get(voteCountRef);

            if (userVoteDoc.exists) {
                alreadyVoted = true;
                console.log(`Voter ${voterId} already voted for ${destinationId}`);
                currentCount = voteCountDoc.exists ? voteCountDoc.data().voteCount : 0;
            } else {
                currentCount = voteCountDoc.exists ? (voteCountDoc.data().voteCount || 0) + 1 : 1;
                // Update vote count
                transaction.set(voteCountRef, { voteCount: currentCount }, { merge: true });
                // Record user's vote
                transaction.set(userVoteRef, { votedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
        });

        // Return appropriate response
        if (alreadyVoted) {
             return {
                statusCode: 200, // Return 200 but indicate already voted
                body: JSON.stringify({ success: false, message: 'Already voted', currentCount: currentCount }),
             };
        } else {
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, message: `Vote recorded for ${destinationId}`, newCount: currentCount }),
            };
        }

    } catch (error) {
        console.error('Voting Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: 'Internal server error processing vote.' }),
        };
    }
};
