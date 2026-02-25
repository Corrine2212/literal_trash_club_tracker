// netlify/functions/hardcover-genre.js
// Proxies book genre lookups to the Hardcover GraphQL API.
// The API key lives in a Netlify env variable — never exposed to the browser.
//
// Setup:
//   1. In Netlify dashboard → Site configuration → Environment variables
//   2. Add: HARDCOVER_API_KEY = Bearer <your_token>
//      (Get your token at https://hardcover.app/account/api)

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.HARDCOVER_API_KEY;
  if (!apiKey) {
    // Not configured — tell the app to fall back gracefully
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'HARDCOVER_API_KEY not set' }) };
  }

  let title, author;
  try {
    ({ title, author } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // Build GraphQL query — search by title (and optionally author), return
  // cached_tags (for genres) and image (for cover), ordered by most-read first
  // so the most popular edition floats to the top.
  const authorFilter = author
    ? `, {contributions: {author: {name: {_ilike: "%${author.replace(/"/g, '')}%"}}}}`
    : '';

  const query = `{
    books(
      where: {_and: [
        {title: {_ilike: "%${title.replace(/"/g, '')}%"}}
        ${authorFilter}
      ]}
      order_by: {users_read_count: desc}
      limit: 3
    ) {
      title
      cached_tags
      image { url }
    }
  }`;

  try {
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: `Hardcover API error: ${res.status}` }) };
    }

    const data = await res.json();
    const books = data?.data?.books || [];

    // Find the first book result that has Genre tags
    let genres = [];
    let coverUrl = null;

    for (const book of books) {
      const tags = book.cached_tags;
      const genreTags = tags?.Genre || [];
      // cached_tags['Genre'] is an array ordered most-tagged first
      if (genreTags.length) {
        genres = genreTags.slice(0, 5); // return top 5, app will normalise
        coverUrl = book.image?.url || null;
        break;
      }
    }

    // If no genre from the top result, still return cover from first result
    if (!coverUrl && books[0]?.image?.url) {
      coverUrl = books[0].image.url;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ genres, coverUrl }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
