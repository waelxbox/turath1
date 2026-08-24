import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

const client = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
const db = drizzle(client);

// Raw query to find the user
const users = await client`
  SELECT id, name, email, role, "createdAt", "lastSignedIn" 
  FROM users 
  WHERE LOWER(name) LIKE '%rochelle%' 
     OR LOWER(email) LIKE '%rochelle%' 
     OR LOWER(name) LIKE '%davis%'
`;

if (users.length === 0) {
  console.log('No user found matching "Rochelle Davis"');
  await client.end();
  process.exit(0);
}

for (const user of users) {
  console.log('\n=== USER ===');
  console.log(`Name: ${user.name}`);
  console.log(`Email: ${user.email}`);
  console.log(`Role: ${user.role}`);
  console.log(`Signed up: ${user.createdAt}`);
  console.log(`Last signed in: ${user.lastSignedIn}`);

  const userProjects = await client`SELECT id, name, status, "createdAt" FROM projects WHERE "userId" = ${user.id}`;
  console.log(`\nProjects created: ${userProjects.length}`);
  for (const p of userProjects) {
    console.log(`  - [${p.id}] "${p.name}" (status: ${p.status}, created: ${p.createdAt})`);  
  }

  const userDocs = await client`SELECT id, "originalName", status, "createdAt" FROM documents WHERE "userId" = ${user.id}`;
  console.log(`\nDocuments uploaded: ${userDocs.length}`);
  for (const d of userDocs.slice(0, 10)) {
    console.log(`  - [${d.id}] "${d.originalName}" (${d.status})`);  
  }
  if (userDocs.length > 10) console.log(`  ... and ${userDocs.length - 10} more`);

  const userReviews = await client`SELECT status, COUNT(*) as cnt FROM document_reviews WHERE "userId" = ${user.id} GROUP BY status`;
  console.log(`\nReview activity:`);
  if (userReviews.length === 0) {
    console.log('  No reviews yet');
  } else {
    for (const r of userReviews) {
      console.log(`  ${r.status}: ${r.cnt}`);
    }
  }
}

await client.end();
